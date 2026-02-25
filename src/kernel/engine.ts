import { createHash } from 'node:crypto';
import {
  IChronos,
  IExecutionContract,
  IOracle,
  IPhysicalManifold,
  Pointer,
  Slice,
  State,
  Transition,
} from './types.js';

export interface IgniteOptions {
  maxTicks?: number;
  onTick?: (tick: number, q: State, d: Pointer) => Promise<void> | void;
}

export interface IgniteResult {
  ticks: number;
  q: State;
  d: Pointer;
}

export class TuringEngine {
  private watchdogHistory: string[] = [];
  private l1TraceCache: string[] = [];
  private readonly l1TraceDepth = 3;
  private readonly watchdogDepth = 5;
  private readonly verificationSignalDepth = 6;
  private readonly trapLoopDepth = 4;
  private lastObservedPointer?: Pointer;
  private lastObservedSlice?: Slice;
  private lastTrapDetails = new Map<string, string>();
  private recentVerificationSignals: string[] = [];
  private trapPointerHistory: string[] = [];

  constructor(
    private manifold: IPhysicalManifold,
    private oracle: IOracle,
    private chronos: IChronos,
    private disciplinePrompt: string,
    private executionContract?: IExecutionContract
  ) {}

  public async tick(q_t: State, d_t: Pointer): Promise<[State, Pointer]> {
    let s_t: Slice;
    const pointer = d_t.trim();
    let nextRequiredDone: string | null = null;
    let progressAppendPointer: Pointer | null = null;
    let nextRequiredFileHint: string | null = null;

    // 1) Observe from the physical manifold.
    try {
      s_t = await this.manifold.observe(d_t);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      const missingFile = !pointer.startsWith('$') && !pointer.startsWith('sys://') && message.includes('File not found');
      s_t = missingFile
        ? [
            `[OS_TRAP: PAGE_FAULT] Target ${d_t} does not exist yet.`,
            `Details: ${message}`,
            'Action: If you are creating this file, continue and write exact content at current pointer.',
          ].join('\n')
        : [
            `[OS_TRAP: PAGE_FAULT] Failed to observe coordinate ${d_t}.`,
            `Details: ${message}`,
            'Action: Create the resource or fix the pointer path in your next cycle.',
          ].join('\n');
    }

    // 1.5) Validate progress contract and feed violations back as trap context.
    if (this.executionContract) {
      try {
        nextRequiredDone = await this.executionContract.getNextRequiredStep();
        nextRequiredFileHint = await this.executionContract.getNextRequiredFileHint();
        const progressPath = this.executionContract.getProgressPath().replace(/^\.\//, '');
        progressAppendPointer = `sys://append/${progressPath}`;
      } catch {
        nextRequiredDone = null;
      }

      try {
        const progressCheck = await this.executionContract.checkProgress();
        if (!progressCheck.ok) {
          const reason = progressCheck.reason ?? 'Unknown contract error.';
          const action = reason.includes('required file is missing')
            ? 'Action: Create the missing file for that DONE step first, then continue to next step.'
            : reason.includes('required file content mismatch')
              ? 'Action: Rewrite the mapped file to exact required content, then append DONE for that step.'
            : reason.includes('Out-of-order progress') || reason.includes('Progress exceeds')
              ? 'Action: Repair progress log to strict ordered DONE:<STEP_ID> prefix.'
              : 'Action: Continue in strict plan order and append one DONE line per completed step.';
          s_t = [
            s_t,
            '',
            '[OS_TRAP: PLAN_CONTRACT] Progress log violates execution contract.',
            `Details: ${reason}`,
            action,
          ].join('\n');
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        s_t = [
          s_t,
          '',
          '[OS_TRAP: PLAN_CONTRACT] Contract checker crashed.',
          `Details: ${message}`,
          'Action: Recover by continuing with strict plan order and DONE markers.',
        ].join('\n');
      }
    }

    // 1.6) Inject memorized trap details for bare trap channels.
    if (pointer.startsWith('sys://trap/') && !pointer.includes('?details=')) {
      const cached = this.lastTrapDetails.get(pointer);
      if (cached) {
        s_t = [s_t, '', '[DETAILS]', cached].join('\n');
      }
    }

    // 1.7) Soft trap for repeated successful command with unchanged observed slice.
    const repeatedSuccessfulCommand =
      pointer.startsWith('$') &&
      this.lastObservedPointer === pointer &&
      this.lastObservedSlice === s_t &&
      s_t.includes('[EXIT_CODE] 0');
    if (repeatedSuccessfulCommand) {
      s_t = [
        s_t,
        '',
        '[OS_TRAP: NO_PROGRESS] Same successful command repeated without state change.',
        'Action: Mark current step once, then move to next planned step and pointer.',
      ].join('\n');
    }

    this.lastObservedPointer = pointer;
    this.lastObservedSlice = s_t;
    this.recordVerificationSignal(pointer, s_t);

    // 1.8) Inject managed context channels for short-horizon anti-looping.
    const callStackSlice = await this.observeCallStackSnapshot();
    const l1TraceSlice = this.renderL1Trace();
    const contractSlice = this.renderContractGuidance(nextRequiredDone, progressAppendPointer, nextRequiredFileHint);
    s_t = [
      '[OS_CONTRACT]',
      contractSlice,
      '',
      '[L1_TRACE_CACHE]',
      l1TraceSlice,
      '',
      '[OS_CALL_STACK]',
      callStackSlice,
      '',
      '[OBSERVED_SLICE]',
      s_t,
    ].join('\n');

    // 2) Run the oracle transition.
    let transition: Transition;
    try {
      transition = await this.oracle.collapse(this.disciplinePrompt, q_t, s_t);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return [
        [
          `[OS_TRAP: CPU_FAULT] Previous output caused kernel panic: ${message}`,
          'You MUST output strictly valid JSON. Keep Todo stack intact and try again.',
          '',
          '[RECOVERED STATE q]:',
          q_t,
        ].join('\n'),
        'sys://trap/cpu_fault',
      ];
    }

    const { q_next, s_prime, d_next } = transition;

    // 2.2) Apply syscall-driven call stack operations (OS-managed memory).
    try {
      await this.applyStackSyscall(transition);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return [
        [
          q_t,
          '',
          `[OS_TRAP: STACK_FAULT] Failed to apply stack syscall: ${message}`,
          'Action: emit valid stack_op and stack_payload (for PUSH) in next JSON transition.',
        ].join('\n'),
        'sys://trap/stack_fault',
      ];
    }

    // 2.5) HALT guard: block HALT unless acceptance contract is satisfied.
    const haltRequested = q_next.trim() === 'HALT' || d_next.trim() === 'HALT';
    if (haltRequested) {
      const verification = this.checkRecentVerificationEvidence();
      if (!verification.ok) {
        const trapDetails = [
          'HALT rejected: physical verification gate is not satisfied.',
          `Details: ${verification.reason}`,
          `Recent signals: ${
            this.recentVerificationSignals.length > 0 ? this.recentVerificationSignals.join(' | ') : '(none)'
          }`,
          'Action: run a validation command ($ ls/$ cat/$ npm test/...) and inspect output before HALT.',
        ].join('\n');
        this.lastTrapDetails.set('sys://trap/illegal_halt', trapDetails);
        return [
          q_t,
          this.systemTrapPointer('sys://trap/illegal_halt', trapDetails),
        ];
      }
    }

    if (haltRequested && this.executionContract) {
      try {
        const haltCheck = await this.executionContract.checkHalt();
        if (!haltCheck.ok) {
          const trapDetails = [
            'HALT rejected: acceptance contract not satisfied.',
            `Details: ${haltCheck.reason ?? 'Unknown contract error.'}`,
            'Action: Complete remaining plan steps and required files, then HALT.',
          ].join('\n');
          this.lastTrapDetails.set('sys://trap/halt_guard', trapDetails);
          return [
            q_t,
            this.systemTrapPointer('sys://trap/halt_guard', trapDetails),
          ];
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        const trapDetails = [
          'Contract checker crashed while validating HALT.',
          `Details: ${message}`,
          'Action: Retry HALT only after contract checker recovers.',
        ].join('\n');
        this.lastTrapDetails.set('sys://trap/halt_guard', trapDetails);
        return [
          q_t,
          this.systemTrapPointer('sys://trap/halt_guard', trapDetails),
        ];
      }
    }

    const trapLoop = this.trackTrapPointerLoop(d_next);
    if (trapLoop.loop) {
      this.watchdogHistory = [];
      this.l1TraceCache = [];
      const trapDetails = [
        'Kernel panic reset: repeated trap pointer loop detected.',
        `Repeated trap: ${trapLoop.trapBase}`,
        'Action: abandon current approach and switch to a different diagnosis path immediately.',
      ].join('\n');
      this.lastTrapDetails.set('sys://trap/panic_reset', trapDetails);
      return [
        [
          '[OS_PANIC: INFINITE_LOOP_KILLED] Repeated trap loop interrupted.',
          `Repeated trap: ${trapLoop.trapBase}`,
          'Action: use a different pointer/command strategy and avoid the last failing function path.',
          '',
          '[RECOVERED STATE q]:',
          q_next,
        ].join('\n'),
        this.systemTrapPointer('sys://trap/panic_reset', trapDetails),
      ];
    }

    // 3) L1 trace pre-watchdog interrupt for short action loops.
    const actionHash = this.actionSignature(d_next, s_prime);
    this.l1TraceCache.push(actionHash);
    if (this.l1TraceCache.length > this.l1TraceDepth) {
      this.l1TraceCache.shift();
    }

    const l1LoopDetected =
      this.l1TraceCache.length === this.l1TraceDepth &&
      this.l1TraceCache.every((item) => item === actionHash);
    if (l1LoopDetected) {
      this.l1TraceCache = [];
      return [
        [
          '[OS_TRAP: L1_CACHE_HIT] Repeated action detected in short horizon.',
          `Action signature: ${actionHash.slice(0, 12)}`,
          'Action: change strategy now (different pointer/command) or PUSH a diagnostic subtask.',
          '',
          '[RECOVERED STATE q]:',
          q_next,
        ].join('\n'),
        'sys://trap/l1_cache_hit',
      ];
    }

    // 3.5) Watchdog non-maskable interrupt against repeated actions.

    this.watchdogHistory.push(actionHash);
    if (this.watchdogHistory.length > this.watchdogDepth) {
      this.watchdogHistory.shift();
    }

    const isStuck =
      this.watchdogHistory.length === this.watchdogDepth &&
      this.watchdogHistory.every((h) => h === actionHash);

    if (isStuck) {
      this.watchdogHistory = [];
      return [
        [
          '[OS_TRAP: WATCHDOG_NMI] INFINITE LOOP DETECTED!',
          'You repeated the same action 5 times with no progress.',
          'Pop current task, log why it failed, and attempt a different strategy.',
          '',
          '[RECOVERED STATE q]:',
          q_next,
        ].join('\n'),
        'sys://trap/watchdog',
      ];
    }

    // 4) Interfere with physical world unless this is a pure read/exec step.
    const isAppendChannel = pointer.startsWith('sys://append/');
    if (s_prime.trim() !== '👆🏻' && (!pointer.startsWith('sys://') || isAppendChannel)) {
      let writePayload = s_prime;
      if (isAppendChannel && progressAppendPointer && pointer === progressAppendPointer) {
        const normalized = await this.normalizeProgressPayload(s_prime, nextRequiredDone, nextRequiredFileHint);
        if (!normalized.ok) {
          return [
            [
              q_next,
              '',
              `[OS_TRAP: IO_FAULT] Failed to write to ${d_t}: ${normalized.reason}`,
              `Action: append exact line DONE:${nextRequiredDone ?? '<none>'} once.`,
            ].join('\n'),
            'sys://trap/io_fault',
          ];
        }

        writePayload = normalized.payload;
      }

      if (!isAppendChannel) {
        const lazyMarker = this.containsLazyWriteMarker(writePayload);
        if (lazyMarker) {
          const trapDetails = [
            'Content contract violation: write payload contains omission marker.',
            `Detected marker: ${lazyMarker}`,
            'Action: output the complete file content with no "... existing ..." placeholders.',
          ].join('\n');
          this.lastTrapDetails.set('sys://trap/content_contract', trapDetails);
          return [
            [
              q_next,
              '',
              '[OS_TRAP: CONTENT_CONTRACT_VIOLATION] Incomplete payload blocked.',
              `Details: ${trapDetails}`,
            ].join('\n'),
            this.systemTrapPointer('sys://trap/content_contract', trapDetails),
          ];
        }
      }

      try {
        await this.manifold.interfere(d_t, writePayload);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return [
          [
            q_next,
            '',
            `[OS_TRAP: IO_FAULT] Failed to write to ${d_t}: ${message}`,
            'Push a task to fix permission or syntax issue and retry.',
          ].join('\n'),
          'sys://trap/io_fault',
        ];
      }
    }

    const shortQ = q_next.split('\n').find((line) => line.trim().length > 0)?.slice(0, 60) ?? 'State updated';
    const shortThought =
      typeof transition.thought === 'string'
        ? transition.thought.split('\n').find((line) => line.trim().length > 0)?.slice(0, 80) ?? ''
        : '';
    const stackOp = transition.stack_op ?? 'NOP';
    const stackNote =
      stackOp === 'PUSH'
        ? `${stackOp}(${(transition.stack_payload ?? '').slice(0, 40)})`
        : stackOp;
    await this.chronos.engrave(
      `[Tick] d:${d_t} -> d':${d_next} | ${shortQ} | stack:${stackNote} | thought:${shortThought || '-'}`
    );

    return [q_next, d_next];
  }

  public async ignite(initialQ: State, initialD: Pointer, options: IgniteOptions = {}): Promise<IgniteResult> {
    const maxTicks = options.maxTicks ?? Number.POSITIVE_INFINITY;
    let ticks = 0;
    let q = initialQ;
    let d = initialD;

    while (q.trim() !== 'HALT' && d.trim() !== 'HALT') {
      if (ticks >= maxTicks) {
        await this.chronos.engrave(`[HALT_GUARD] Max ticks reached: ${maxTicks}`);
        break;
      }

      [q, d] = await this.tick(q, d);
      ticks += 1;

      if (options.onTick) {
        await options.onTick(ticks, q, d);
      }
    }

    return { ticks, q, d };
  }

  private systemTrapPointer(base: string, details: string): Pointer {
    return `${base}?details=${encodeURIComponent(details)}`;
  }

  private actionSignature(dNext: Pointer, sPrime: string): string {
    return createHash('sha256')
      .update(`${dNext}|${sPrime.slice(0, 120)}`)
      .digest('hex');
  }

  private renderL1Trace(): string {
    if (this.l1TraceCache.length === 0) {
      return '(empty)';
    }

    return this.l1TraceCache
      .map((hash, idx) => `${idx + 1}. ${hash.slice(0, 12)}`)
      .join('\n');
  }

  private async observeCallStackSnapshot(): Promise<string> {
    try {
      return await this.manifold.observe('sys://callstack');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return `[SYSTEM_CHANNEL] sys://callstack\n[DETAILS]\nUnavailable: ${message}`;
    }
  }

  private async applyStackSyscall(transition: Transition): Promise<void> {
    const op = transition.stack_op;
    if (op === 'NOP') {
      return;
    }

    if (op === 'POP') {
      await this.manifold.interfere('sys://callstack', 'POP');
      return;
    }

    const payload = (transition.stack_payload ?? '').trim();
    if (payload.length === 0) {
      throw new Error('PUSH requires stack_payload.');
    }

    await this.manifold.interfere('sys://callstack', `PUSH: ${payload}`);
  }

  private renderContractGuidance(
    nextRequiredDone: string | null,
    progressAppendPointer: Pointer | null,
    nextRequiredFileHint: string | null
  ): string {
    const next = nextRequiredDone ? `DONE:${nextRequiredDone}` : '(complete)';
    return [
      `[NEXT_REQUIRED_DONE] ${next}`,
      `[PROGRESS_APPEND_POINTER] ${progressAppendPointer ?? '(n/a)'}`,
      `[NEXT_REQUIRED_FILE_HINT] ${nextRequiredFileHint ?? '(none)'}`,
      'Rule: append exactly one DONE line for NEXT_REQUIRED_DONE; do not rewrite whole progress log.',
    ].join('\n');
  }

  private normalizeProgressPayload(
    payload: string,
    nextRequiredDone: string | null,
    nextRequiredFileHint: string | null
  ): Promise<{ ok: true; payload: string } | { ok: false; reason: string }> {
    if (!nextRequiredDone) {
      return Promise.resolve({ ok: false, reason: 'Plan already complete; no further DONE append allowed.' });
    }

    const expectedLine = `DONE:${nextRequiredDone}`;
    const candidate = payload
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.length > 0);

    if (!candidate) {
      return Promise.resolve({ ok: false, reason: 'Empty append payload.' });
    }

    const compact = candidate.replace(/\s+/g, '').toUpperCase();
    if (compact === expectedLine.replace(/\s+/g, '').toUpperCase()) {
      return this.enforceStepArtifactBeforeDone(expectedLine, nextRequiredFileHint);
    }

    if (compact === nextRequiredDone.replace(/\s+/g, '').toUpperCase()) {
      return this.enforceStepArtifactBeforeDone(expectedLine, nextRequiredFileHint);
    }

    const doneMatch = candidate.match(/^DONE[:：]\s*(.+)$/i);
    if (doneMatch?.[1]) {
      const doneStep = doneMatch[1].trim();
      if (doneStep === nextRequiredDone || doneStep.includes(nextRequiredDone)) {
        return this.enforceStepArtifactBeforeDone(expectedLine, nextRequiredFileHint);
      }
    } else if (candidate.includes(nextRequiredDone)) {
      return this.enforceStepArtifactBeforeDone(expectedLine, nextRequiredFileHint);
    }

    return Promise.resolve({
      ok: false,
      reason: `Progress strictly requires ${expectedLine}, got "${candidate.slice(0, 120)}".`,
    });
  }

  private async enforceStepArtifactBeforeDone(
    expectedLine: string,
    nextRequiredFileHint: string | null
  ): Promise<{ ok: true; payload: string } | { ok: false; reason: string }> {
    if (this.executionContract) {
      const readiness = await this.executionContract.checkNextRequiredStepReady();
      if (!readiness.ok) {
        return {
          ok: false,
          reason: readiness.reason ?? 'Next required step is not ready for DONE append.',
        };
      }
      return { ok: true, payload: expectedLine };
    }

    if (!nextRequiredFileHint) {
      return { ok: true, payload: expectedLine };
    }

    try {
      await this.manifold.observe(nextRequiredFileHint);
      return { ok: true, payload: expectedLine };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        reason: `Step artifact missing before DONE append: ${nextRequiredFileHint}. ${message}`,
      };
    }
  }

  private recordVerificationSignal(pointer: Pointer, observedSlice: Slice): void {
    if (pointer.startsWith('$')) {
      const command = pointer.replace(/^\$\s*/, '').trim();
      if (command.length === 0 || !observedSlice.includes('[EXIT_CODE] 0')) {
        return;
      }

      if (this.isVerificationCommand(command)) {
        this.pushVerificationSignal(`CMD:${command}`);
      }
      return;
    }

    if (pointer.startsWith('sys://') || pointer.trim().length === 0) {
      return;
    }

    if (observedSlice.includes('[OS_TRAP: PAGE_FAULT]')) {
      return;
    }

    this.pushVerificationSignal(`READ:${pointer}`);
  }

  private pushVerificationSignal(signal: string): void {
    const normalized = signal.trim();
    if (normalized.length === 0) {
      return;
    }

    this.recentVerificationSignals.push(normalized.slice(0, 120));
    if (this.recentVerificationSignals.length > this.verificationSignalDepth) {
      this.recentVerificationSignals.shift();
    }
  }

  private isVerificationCommand(command: string): boolean {
    const normalized = command.toLowerCase();
    const patterns = [
      /\b(ls|cat|head|tail|sed|grep|wc|find|stat|test)\b/,
      /\b(npm|pnpm|yarn)\s+(test|run\s+\S+)/,
      /\b(pytest|python|node|tsx|ts-node|go\s+test|cargo\s+test)\b/,
    ];
    return patterns.some((pattern) => pattern.test(normalized));
  }

  private checkRecentVerificationEvidence(): { ok: true } | { ok: false; reason: string } {
    if (this.recentVerificationSignals.length > 0) {
      return { ok: true };
    }

    return {
      ok: false,
      reason: 'No recent physical verification evidence was observed.',
    };
  }

  private trackTrapPointerLoop(pointer: Pointer): { loop: false } | { loop: true; trapBase: string } {
    const trimmed = pointer.trim();
    if (!trimmed.startsWith('sys://trap/')) {
      this.trapPointerHistory = [];
      return { loop: false };
    }

    const trapBase = trimmed.split('?', 1)[0];
    this.trapPointerHistory.push(trapBase);
    if (this.trapPointerHistory.length > this.trapLoopDepth) {
      this.trapPointerHistory.shift();
    }

    const loopDetected =
      this.trapPointerHistory.length === this.trapLoopDepth &&
      this.trapPointerHistory.every((item) => item === trapBase);

    if (loopDetected) {
      this.trapPointerHistory = [];
      return { loop: true, trapBase };
    }

    return { loop: false };
  }

  private containsLazyWriteMarker(payload: string): string | null {
    const markers = [
      /\/\/\s*\.\.\.\s*(existing|rest)/i,
      /\/\*\s*\.\.\./i,
      /\b(rest of the code|existing code here)\b/i,
      /(此处省略|后续省略|略去)/i,
    ];

    for (const marker of markers) {
      const matched = payload.match(marker);
      if (matched?.[0]) {
        return matched[0];
      }
    }

    return null;
  }
}

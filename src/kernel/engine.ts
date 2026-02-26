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
  private readonly oracleFrameHardLimitChars = 4096;
  private readonly oracleContractMaxChars = 640;
  private readonly oracleL1TraceMaxChars = 320;
  private readonly oracleCallStackMaxChars = 768;
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
    let nextRequiredReady: boolean | null = null;
    let nextRequiredReason: string | null = null;

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
        const readiness = await this.executionContract.checkNextRequiredStepReady();
        nextRequiredReady = readiness.ok;
        nextRequiredReason = readiness.ok ? null : readiness.reason ?? 'Next required step is not ready.';

        // Auto-heal exact-text mismatch before ALU step to reduce repair loops.
        if (!nextRequiredReady) {
          const expectedExact = this.extractExpectedExact(nextRequiredReason);
          if (expectedExact && nextRequiredFileHint) {
            try {
              await this.manifold.interfere(nextRequiredFileHint, expectedExact);
              await this.chronos.engrave(
                `[OS_AUTO_HEAL] Patched ${nextRequiredFileHint} to expected exact content for DONE:${
                  nextRequiredDone ?? 'UNKNOWN'
                }.`
              );

              const recheck = await this.executionContract.checkNextRequiredStepReady();
              nextRequiredReady = recheck.ok;
              nextRequiredReason = recheck.ok ? null : recheck.reason ?? 'Next required step is not ready.';
            } catch {
              // Non-fatal; keep original readiness state.
            }
          }
        }
      } catch {
        nextRequiredDone = null;
        nextRequiredReady = null;
        nextRequiredReason = null;
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

      if (nextRequiredDone && progressAppendPointer && pointer !== progressAppendPointer) {
        try {
          const autoProgress = await this.tryAutoAppendProgress(nextRequiredDone, progressAppendPointer);
          if (autoProgress.appended) {
            nextRequiredDone = await this.executionContract.getNextRequiredStep();
            nextRequiredFileHint = await this.executionContract.getNextRequiredFileHint();
            s_t = [
              s_t,
              '',
              '[OS_AUTO_PROGRESS]',
              `Auto-appended ${autoProgress.line} after artifact readiness check.`,
            ].join('\n');
          }
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          s_t = [
            s_t,
            '',
            '[OS_TRAP: PLAN_CONTRACT]',
            `Auto-progress evaluator failed: ${message}`,
          ].join('\n');
        }
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
    const contractSlice = this.renderContractGuidance(
      nextRequiredDone,
      progressAppendPointer,
      nextRequiredFileHint,
      nextRequiredReady,
      nextRequiredReason
    );
    const frameGuard = this.composeOracleFrame(contractSlice, l1TraceSlice, callStackSlice, s_t);
    if (frameGuard.truncated) {
      await this.chronos.engrave(
        `[FRAME_HARD_LIMIT] original=${frameGuard.originalLength} emitted=${frameGuard.emittedLength} hash=${frameGuard.hash} clipped=${frameGuard.clippedSections.join(
          ','
        )}`
      );
    }
    s_t = frameGuard.slice;

    // 2) Run the oracle transition.
    let transition: Transition;
    try {
      transition = await this.oracle.collapse(this.disciplinePrompt, q_t, s_t);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      const invalidOpcode = message.includes('INVALID_OPCODE');
      const trapDetails = invalidOpcode
        ? `Invalid opcode or malformed syscall ABI: ${message}`
        : `Previous output caused kernel panic: ${message}`;
      return this.raiseManagedTrap(
        'sys://trap/cpu_fault',
        trapDetails,
        [
          `[OS_TRAP: CPU_FAULT] ${trapDetails}`,
          'You MUST output strict JSON with a_t.op and valid SYS_* opcode.',
          '',
          '[RECOVERED STATE q]:',
          q_t,
        ].join('\n'),
        q_t
      );
    }

    const q_next = transition.q_next;
    let d_next: Pointer = d_t;
    let writePointer: Pointer = d_t;
    let s_prime = '👆🏻';

    try {
      const syscall = transition.a_t;
      const strictViolation = this.validateSyscallEnvelope(syscall as unknown as Record<string, unknown>);
      if (strictViolation) {
        throw new Error(`[CPU_FAULT: INVALID_OPCODE] ${strictViolation}`);
      }
      switch (syscall.op) {
        case 'SYS_WRITE':
          d_next = d_t;
          writePointer = typeof syscall.semantic_cap === 'string' && syscall.semantic_cap.trim().length > 0
            ? syscall.semantic_cap.trim()
            : d_t;
          s_prime = syscall.payload;
          break;
        case 'SYS_GOTO':
          d_next = syscall.pointer;
          s_prime = '👆🏻';
          break;
        case 'SYS_EXEC': {
          const cmd = syscall.cmd.trim();
          d_next = cmd.startsWith('$') ? cmd : `$ ${cmd}`;
          s_prime = '👆🏻';
          break;
        }
        case 'SYS_PUSH': {
          const task = syscall.task.trim();
          if (task.length === 0) {
            throw new Error('SYS_PUSH requires non-empty task.');
          }
          await this.manifold.interfere('sys://callstack', `PUSH: ${task}`);
          d_next = d_t;
          s_prime = '👆🏻';
          break;
        }
        case 'SYS_POP':
          await this.manifold.interfere('sys://callstack', 'POP');
          d_next = d_t;
          s_prime = '👆🏻';
          break;
        case 'SYS_HALT':
          d_next = 'HALT';
          s_prime = '👆🏻';
          break;
        default: {
          const exhaustiveCheck: never = syscall;
          throw new Error(`Unhandled syscall variant: ${JSON.stringify(exhaustiveCheck)}`);
        }
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return this.raiseManagedTrap(
        'sys://trap/cpu_fault',
        `Failed to dispatch syscall: ${message}`,
        [
          q_t,
          '',
          `[OS_TRAP: CPU_FAULT] Failed to dispatch syscall: ${message}`,
          'Action: emit one valid opcode in a_t.op (SYS_WRITE/SYS_GOTO/SYS_EXEC/SYS_PUSH/SYS_POP/SYS_HALT).',
        ].join('\n'),
        q_t
      );
    }

    const replayTuple = {
      h_q: createHash('sha256').update(q_t).digest('hex'),
      h_s: createHash('sha256').update(s_t).digest('hex'),
      d_t,
      write_target:
        typeof transition.a_t.op === 'string' && transition.a_t.op === 'SYS_WRITE'
          ? writePointer
          : d_next,
      a_t: transition.a_t,
    };
    await this.chronos.engrave(`[REPLAY_TUPLE] ${JSON.stringify(replayTuple)}`);

    // 2.5) HALT guard: block HALT unless acceptance contract is satisfied.
    const haltRequested = q_next.trim() === 'HALT' || d_next.trim() === 'HALT' || transition.a_t.op === 'SYS_HALT';
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

    // 3) Action-loop interrupts: evaluate watchdog (deep horizon) before L1 (short horizon).
    const actionHash = this.actionSignature(d_next, s_prime);
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

    // 4) Interfere with physical world unless this is a pure read/exec step.
    const writePointerTrimmed = writePointer.trim();
    const isAppendChannel = writePointerTrimmed.startsWith('sys://append/');
    const isReplaceChannel = writePointerTrimmed.startsWith('sys://replace/');
    if (
      s_prime.trim() !== '👆🏻' &&
      (!writePointerTrimmed.startsWith('sys://') || isAppendChannel || isReplaceChannel)
    ) {
      let writePayload = s_prime;
      if (isAppendChannel && progressAppendPointer && writePointerTrimmed === progressAppendPointer) {
        const normalized = await this.normalizeProgressPayload(s_prime, nextRequiredDone, nextRequiredFileHint);
        if (!normalized.ok) {
          return [
            [
              q_next,
              '',
              `[OS_TRAP: IO_FAULT] Failed to write to ${writePointerTrimmed}: ${normalized.reason}`,
              `Action: append exact line DONE:${nextRequiredDone ?? '<none>'} once.`,
            ].join('\n'),
            'sys://trap/io_fault',
          ];
        }

        writePayload = normalized.payload;
      }

      const writeTarget = this.resolveWriteTargetPointer(writePointerTrimmed);
      const expectedExact = this.extractExpectedExact(nextRequiredReason);
      if (
        writeTarget &&
        nextRequiredFileHint &&
        expectedExact &&
        this.samePath(writeTarget, nextRequiredFileHint) &&
        this.normalizeContent(writePayload) !== this.normalizeContent(expectedExact)
      ) {
        const previousPreview = writePayload.replace(/\s+/g, ' ').slice(0, 80);
        writePayload = expectedExact;
        await this.chronos.engrave(
          `[OS_AUTO_FIX] Enforced expected content for ${nextRequiredFileHint}. prev="${previousPreview}" next="${expectedExact.replace(
            /\s+/g,
            ' '
          )}"`
        );
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
        await this.manifold.interfere(writePointerTrimmed, writePayload);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return [
          [
            q_next,
            '',
            `[OS_TRAP: IO_FAULT] Failed to write to ${writePointerTrimmed}: ${message}`,
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
    const syscallNote = this.renderSyscallNote(transition);
    await this.chronos.engrave(
      `[Tick] d:${d_t} -> d':${d_next} | ${shortQ} | syscall:${syscallNote} | thought:${shortThought || '-'}`
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

  private raiseManagedTrap(
    trapBase: string,
    details: string,
    trapState: State,
    recoveredState: State
  ): [State, Pointer] {
    this.lastTrapDetails.set(trapBase, details);
    const pointer = this.systemTrapPointer(trapBase, details);
    const trapLoop = this.trackTrapPointerLoop(pointer);
    if (trapLoop.loop) {
      const panicDetails = [
        'Kernel panic reset: repeated trap pointer loop detected.',
        `Repeated trap: ${trapLoop.trapBase}`,
        'Action: abandon current approach and switch to a different diagnosis path immediately.',
      ].join('\n');
      this.lastTrapDetails.set('sys://trap/panic_reset', panicDetails);
      return [
        [
          '[OS_PANIC: INFINITE_LOOP_KILLED] Repeated trap loop interrupted.',
          `Repeated trap: ${trapLoop.trapBase}`,
          'Action: use a different pointer/command strategy and avoid the last failing function path.',
          '',
          '[RECOVERED STATE q]:',
          recoveredState,
        ].join('\n'),
        this.systemTrapPointer('sys://trap/panic_reset', panicDetails),
      ];
    }

    return [trapState, pointer];
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

  private renderSyscallNote(transition: Transition): string {
    const syscall = transition.a_t;
    switch (syscall.op) {
      case 'SYS_WRITE':
        return `${syscall.op}(len=${syscall.payload.length}${
          syscall.semantic_cap ? `,cap=${syscall.semantic_cap.slice(0, 32)}` : ''
        })`;
      case 'SYS_GOTO':
        return `${syscall.op}(${syscall.pointer.slice(0, 40)})`;
      case 'SYS_EXEC':
        return `${syscall.op}(${syscall.cmd.slice(0, 40)})`;
      case 'SYS_PUSH':
        return `${syscall.op}(${syscall.task.slice(0, 40)})`;
      case 'SYS_POP':
      case 'SYS_HALT':
        return syscall.op;
      default: {
        const exhaustiveCheck: never = syscall;
        return `UNKNOWN(${JSON.stringify(exhaustiveCheck)})`;
      }
    }
  }

  private validateSyscallEnvelope(syscall: Record<string, unknown>): string | null {
    const op = typeof syscall.op === 'string' ? syscall.op : '';
    if (op.length === 0) {
      return 'Missing syscall op field.';
    }

    const keys = Object.keys(syscall);
    const allowSet = (allowed: string[]): string | null => {
      const disallowed = keys.filter((key) => !allowed.includes(key));
      if (disallowed.length > 0) {
        return `MUTEX_VIOLATION: ${op} carries extra fields: ${disallowed.join(', ')}`;
      }
      return null;
    };

    if (op === 'SYS_WRITE') {
      return allowSet(['op', 'payload', 'semantic_cap']);
    }
    if (op === 'SYS_GOTO') {
      return allowSet(['op', 'pointer']);
    }
    if (op === 'SYS_EXEC') {
      return allowSet(['op', 'cmd']);
    }
    if (op === 'SYS_PUSH') {
      return allowSet(['op', 'task']);
    }
    if (op === 'SYS_POP' || op === 'SYS_HALT') {
      return allowSet(['op']);
    }

    return `Unknown syscall op: ${op}`;
  }

  private renderContractGuidance(
    nextRequiredDone: string | null,
    progressAppendPointer: Pointer | null,
    nextRequiredFileHint: string | null,
    nextRequiredReady: boolean | null,
    nextRequiredReason: string | null
  ): string {
    const next = nextRequiredDone ? `DONE:${nextRequiredDone}` : '(complete)';
    const readyState =
      nextRequiredDone === null
        ? 'N/A'
        : nextRequiredReady === null
          ? 'UNKNOWN'
          : nextRequiredReady
            ? 'READY'
            : 'BLOCKED';
    return [
      `[NEXT_REQUIRED_DONE] ${next}`,
      `[NEXT_REQUIRED_STATUS] ${readyState}`,
      `[PROGRESS_APPEND_POINTER] ${progressAppendPointer ?? '(n/a)'}`,
      `[NEXT_REQUIRED_FILE_HINT] ${nextRequiredFileHint ?? '(none)'}`,
      `[NEXT_REQUIRED_REASON] ${nextRequiredReason ?? '(none)'}`,
      'Rule: append exactly one DONE line for NEXT_REQUIRED_DONE; do not rewrite whole progress log.',
    ].join('\n');
  }

  private composeOracleFrame(
    contractSlice: Slice,
    l1TraceSlice: Slice,
    callStackSlice: Slice,
    observedSlice: Slice
  ): {
    slice: Slice;
    truncated: boolean;
    originalLength: number;
    emittedLength: number;
    hash: string;
    clippedSections: string[];
  } {
    const raw = [
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
      observedSlice,
    ].join('\n');

    const clippedSections: string[] = [];
    const contract = this.clipFrameSection(
      'OS_CONTRACT',
      contractSlice,
      this.oracleContractMaxChars,
      clippedSections
    );
    const l1Trace = this.clipFrameSection(
      'L1_TRACE_CACHE',
      l1TraceSlice,
      this.oracleL1TraceMaxChars,
      clippedSections
    );
    const callStack = this.clipFrameSection(
      'OS_CALL_STACK',
      callStackSlice,
      this.oracleCallStackMaxChars,
      clippedSections
    );

    const prefix = [
      '[OS_CONTRACT]',
      contract,
      '',
      '[L1_TRACE_CACHE]',
      l1Trace,
      '',
      '[OS_CALL_STACK]',
      callStack,
      '',
      '[OBSERVED_SLICE]',
    ].join('\n');
    const observedBudget = Math.max(0, this.oracleFrameHardLimitChars - prefix.length - 1);
    const observed = this.clipFrameSection('OBSERVED_SLICE', observedSlice, observedBudget, clippedSections);
    const assembled = `${prefix}\n${observed}`;
    const fallback = this.applyOracleFrameHardLimit(assembled);
    const truncated = clippedSections.length > 0 || fallback.truncated;

    return {
      slice: fallback.slice,
      truncated,
      originalLength: raw.length,
      emittedLength: fallback.emittedLength,
      hash: fallback.hash,
      clippedSections,
    };
  }

  private clipFrameSection(section: string, content: string, limit: number, clippedSections: string[]): string {
    if (content.length <= limit) {
      return content;
    }
    clippedSections.push(section);

    const header = `[OS_SECTION_CLIPPED] ${section} chars=${content.length} limit=${limit}`;
    if (limit <= header.length) {
      return header.slice(0, Math.max(0, limit));
    }

    const bodyBudget = limit - header.length - 1;
    return `${header}\n${content.slice(0, Math.max(0, bodyBudget))}`;
  }

  private applyOracleFrameHardLimit(frame: Slice): {
    slice: Slice;
    truncated: boolean;
    originalLength: number;
    emittedLength: number;
    hash: string;
  } {
    const originalLength = frame.length;
    const hash = createHash('sha256').update(frame).digest('hex').slice(0, 16);
    if (originalLength <= this.oracleFrameHardLimitChars) {
      return {
        slice: frame,
        truncated: false,
        originalLength,
        emittedLength: originalLength,
        hash,
      };
    }

    const header = [
      '[OS_FRAME_HARD_LIMIT]',
      `MaxChars=${this.oracleFrameHardLimitChars}`,
      `OriginalChars=${originalLength}`,
      `FrameHash=${hash}`,
      'Action: use SYS_GOTO/SYS_EXEC to page through full evidence; this frame is clipped for O(1) safety.',
      '',
    ].join('\n');
    const footer = '\n\n[OS_FRAME_HARD_LIMIT_END]';
    const budget = Math.max(0, this.oracleFrameHardLimitChars - header.length - footer.length);
    const clipped = frame.slice(0, budget);
    const guarded = `${header}${clipped}${footer}`;

    return {
      slice: guarded,
      truncated: true,
      originalLength,
      emittedLength: guarded.length,
      hash,
    };
  }

  private async normalizeProgressPayload(
    payload: string,
    nextRequiredDone: string | null,
    nextRequiredFileHint: string | null
  ): Promise<{ ok: true; payload: string } | { ok: false; reason: string }> {
    if (!nextRequiredDone) {
      return { ok: false, reason: 'Plan already complete; no further DONE append allowed.' };
    }

    const expectedLine = `DONE:${nextRequiredDone}`;
    const doneCandidate = this.extractDoneCandidate(payload, nextRequiredDone);
    if (!doneCandidate) {
      const readinessFallback = await this.enforceStepArtifactBeforeDone(expectedLine, nextRequiredFileHint);
      if (readinessFallback.ok) {
        return readinessFallback;
      }

      const preview = payload
        .split('\n')
        .map((line) => line.trim())
        .find((line) => line.length > 0);
      return {
        ok: false,
        reason: `Unable to parse DONE marker from append payload "${(preview ?? '').slice(0, 120)}".`,
      };
    }

    if (this.sameStep(doneCandidate.stepId, nextRequiredDone)) {
      return this.enforceStepArtifactBeforeDone(expectedLine, nextRequiredFileHint);
    }

    return {
      ok: false,
      reason: `Progress strictly requires ${expectedLine}, got "${doneCandidate.rawLine.slice(0, 120)}".`,
    };
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
    const commandSignals = this.recentVerificationSignals.filter((signal) => signal.startsWith('CMD:'));
    if (commandSignals.length > 0) {
      return { ok: true };
    }

    return {
      ok: false,
      reason: 'No successful verification command was observed. Require CMD:* signal with [EXIT_CODE] 0.',
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

  private resolveWriteTargetPointer(pointer: Pointer): string | null {
    const trimmed = pointer.trim();
    if (trimmed.length === 0) {
      return null;
    }

    if (trimmed.startsWith('sys://replace/')) {
      const target = trimmed.slice('sys://replace/'.length).trim();
      return target.length > 0 ? target : null;
    }

    if (trimmed.startsWith('sys://append/')) {
      const target = trimmed.slice('sys://append/'.length).trim();
      return target.length > 0 ? target : null;
    }

    if (trimmed.startsWith('sys://') || trimmed.startsWith('$')) {
      return null;
    }

    return trimmed;
  }

  private extractExpectedExact(reason: string | null): string | null {
    if (!reason) {
      return null;
    }

    const match = reason.match(/expected="([^"]*)"/i);
    if (!match?.[1]) {
      return null;
    }

    return match[1];
  }

  private normalizeContent(content: string): string {
    return content.replace(/\r\n/g, '\n').trim();
  }

  private samePath(left: string, right: string): boolean {
    const normalize = (value: string): string => value.replace(/^\.\//, '').trim();
    return normalize(left) === normalize(right);
  }

  private async tryAutoAppendProgress(
    nextRequiredDone: string,
    progressAppendPointer: Pointer
  ): Promise<{ appended: boolean; line: string }> {
    const expectedLine = `DONE:${nextRequiredDone}`;
    if (!this.executionContract) {
      return { appended: false, line: expectedLine };
    }

    const readiness = await this.executionContract.checkNextRequiredStepReady();
    if (!readiness.ok) {
      return { appended: false, line: expectedLine };
    }

    try {
      await this.manifold.interfere(progressAppendPointer, expectedLine);
      return { appended: true, line: expectedLine };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('Duplicate append blocked')) {
        return { appended: false, line: expectedLine };
      }
      throw error;
    }
  }

  private extractDoneCandidate(
    payload: string,
    nextRequiredDone: string
  ): { stepId: string; rawLine: string } | null {
    const lines = payload
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    for (const line of lines) {
      const strictDone = line.match(/^DONE[:：\-\s]*([A-Za-z0-9_/-]+)/i);
      if (strictDone?.[1]) {
        return { stepId: strictDone[1].trim(), rawLine: line };
      }

      const doneAnywhere = line.match(/\bDONE[:：\-\s]*([A-Za-z0-9_/-]+)/i);
      if (doneAnywhere?.[1]) {
        return { stepId: doneAnywhere[1].trim(), rawLine: line };
      }

      if (this.sameStep(line, nextRequiredDone)) {
        return { stepId: nextRequiredDone, rawLine: line };
      }

      if (line.toUpperCase().includes(nextRequiredDone.toUpperCase())) {
        return { stepId: nextRequiredDone, rawLine: line };
      }

      const milestoneMatch = line.match(/milestone\s*0?(\d{1,3})/i);
      const targetMilestone = nextRequiredDone.match(/^M(\d{1,3})$/i);
      if (milestoneMatch?.[1] && targetMilestone?.[1]) {
        const got = Number.parseInt(milestoneMatch[1], 10);
        const expected = Number.parseInt(targetMilestone[1], 10);
        if (Number.isFinite(got) && got === expected) {
          return { stepId: nextRequiredDone, rawLine: line };
        }
      }
    }

    return null;
  }

  private sameStep(left: string, right: string): boolean {
    const normalize = (value: string): string =>
      value
        .replace(/^DONE[:：\-\s]*/i, '')
        .replace(/\s+/g, '')
        .toUpperCase();
    return normalize(left) === normalize(right);
  }
}

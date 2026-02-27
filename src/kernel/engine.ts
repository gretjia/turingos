import { createHash } from 'node:crypto';
import { SYSCALL_OPCODE_SLASH, validateCanonicalSyscallEnvelope } from './syscall-schema.js';
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

interface TrapFrame {
  seq: number;
  ts: string;
  trap_base: string;
  trap_pointer: Pointer;
  details: string;
  panic_reset_count: number;
  metadata?: Record<string, unknown>;
}

export class TuringEngine {
  private watchdogHistory: string[] = [];
  private l1TraceCache: string[] = [];
  private mindSchedulingHistory: Array<'SYS_EDIT' | 'SYS_MOVE'> = [];
  private readonly l1TraceDepth = 3;
  private readonly watchdogDepth = 5;
  private readonly thrashingDepth = 3;
  private readonly verificationSignalDepth = 6;
  private readonly trapLoopDepth = 4;
  private readonly oracleFrameHardLimitChars = 4096;
  private readonly oracleFrameMinChars = 1024;
  private readonly oracleFrameSafetyMarginChars = 512;
  private readonly oracleObservedMinChars = 512;
  private readonly maxPanicResets = 2;
  private readonly oracleRequestCharBudget = Number.parseInt(process.env.TURINGOS_ALU_REQUEST_CHAR_BUDGET ?? '8192', 10);
  private replayTupleSeq = 0;
  private replayMerkleRoot = 'GENESIS';
  private replayCursorLoaded = false;
  private trapFrameSeq = 0;
  private panicResetCount = 0;
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
    const observedSliceForReplay = s_t;
    const callStackSlice = await this.observeCallStackSnapshot();
    const l1TraceSlice = this.renderL1Trace();
    const contractSlice = this.renderContractGuidance(
      nextRequiredDone,
      progressAppendPointer,
      nextRequiredFileHint,
      nextRequiredReady,
      nextRequiredReason
    );
    const frameGuard = this.composeOracleFrame(q_t, contractSlice, l1TraceSlice, callStackSlice, s_t);
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
    const routeTrace = this.consumeOracleRouteTrace();
    if (routeTrace) {
      await this.chronos.engrave(`[BUS_ROUTE] ${routeTrace}`);
    }

    const q_next = transition.q_next;
    let d_next: Pointer = d_t;
    let writePointer: Pointer = d_t;
    let s_prime = '👆🏻';

    try {
      const syscall = transition.a_t;
      const strictViolation = validateCanonicalSyscallEnvelope(syscall);
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
        case 'SYS_GIT_LOG':
          d_next = this.composeGitLogPointer(syscall);
          s_prime = '👆🏻';
          break;
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
        case 'SYS_EDIT': {
          const task = syscall.task.trim();
          if (task.length === 0) {
            throw new Error('SYS_EDIT requires non-empty task.');
          }
          await this.manifold.interfere('sys://callstack', `EDIT: ${task}`);
          d_next = d_t;
          s_prime = '👆🏻';
          break;
        }
        case 'SYS_MOVE': {
          const parts: string[] = [];
          if (typeof syscall.task_id === 'string' && syscall.task_id.trim().length > 0) {
            parts.push(`task_id=${syscall.task_id.trim()}`);
          }
          const targetPosRaw = typeof syscall.target_pos === 'string' ? syscall.target_pos.trim().toUpperCase() : '';
          const targetPos = targetPosRaw === 'TOP' || targetPosRaw === 'BOTTOM' ? targetPosRaw : 'BOTTOM';
          parts.push(`target_pos=${targetPos}`);
          const statusRaw = typeof syscall.status === 'string' ? syscall.status.trim().toUpperCase() : '';
          if (statusRaw === 'ACTIVE' || statusRaw === 'SUSPENDED' || statusRaw === 'BLOCKED') {
            parts.push(`status=${statusRaw}`);
          }
          await this.manifold.interfere('sys://callstack', `MOVE: ${parts.join('; ')}`);
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
          `Action: emit one valid opcode in a_t.op (${SYSCALL_OPCODE_SLASH}).`,
        ].join('\n'),
        q_t
      );
    }

    await this.ensureReplayCursorLoaded();
    const replayPayload = {
      tick_seq: this.replayTupleSeq,
      q_t,
      h_q: createHash('sha256').update(q_t).digest('hex'),
      d_t,
      observed_slice: observedSliceForReplay,
      s_t,
      h_s: createHash('sha256').update(s_t).digest('hex'),
      a_t: transition.a_t,
      q_next,
      d_next,
      write_target:
        typeof transition.a_t.op === 'string' && transition.a_t.op === 'SYS_WRITE'
          ? writePointer
          : d_next,
    };
    const leafHash = createHash('sha256').update(JSON.stringify(replayPayload)).digest('hex');
    const prevMerkleRoot = this.replayMerkleRoot;
    const merkleRoot = createHash('sha256').update(`${prevMerkleRoot}\n${leafHash}`).digest('hex');
    this.replayMerkleRoot = merkleRoot;
    this.replayTupleSeq += 1;

    const replayTuple = {
      ...replayPayload,
      leaf_hash: leafHash,
      prev_merkle_root: prevMerkleRoot,
      merkle_root: merkleRoot,
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
          'Action: run a test command (e.g., $ npm test / $ pytest / $ go test) and inspect output before HALT.',
        ].join('\n');
        this.lastTrapDetails.set('sys://trap/illegal_halt', trapDetails);
        return this.trapReturn(
          'sys://trap/illegal_halt',
          trapDetails,
          q_t,
          this.systemTrapPointer('sys://trap/illegal_halt', trapDetails),
          { source: 'halt_guard', guard: 'verification' }
        );
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
          return this.trapReturn(
            'sys://trap/halt_guard',
            trapDetails,
            q_t,
            this.systemTrapPointer('sys://trap/halt_guard', trapDetails),
            { source: 'halt_guard', guard: 'acceptance_contract' }
          );
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        const trapDetails = [
          'Contract checker crashed while validating HALT.',
          `Details: ${message}`,
          'Action: Retry HALT only after contract checker recovers.',
        ].join('\n');
        this.lastTrapDetails.set('sys://trap/halt_guard', trapDetails);
        return this.trapReturn(
          'sys://trap/halt_guard',
          trapDetails,
          q_t,
          this.systemTrapPointer('sys://trap/halt_guard', trapDetails),
          { source: 'halt_guard', guard: 'contract_crash' }
        );
      }
    }

    const trapLoop = this.trackTrapPointerLoop(d_next);
    if (trapLoop.loop) {
      this.watchdogHistory = [];
      this.l1TraceCache = [];
      return this.panicResetFromLoop(trapLoop.trapBase, q_next);
    }

    // 3) Action-loop interrupts: evaluate watchdog (deep horizon) before L1 (short horizon).
    const syscallOp = transition.a_t.op;
    if (syscallOp === 'SYS_EDIT' || syscallOp === 'SYS_MOVE') {
      this.mindSchedulingHistory.push(syscallOp);
      if (this.mindSchedulingHistory.length > this.thrashingDepth) {
        this.mindSchedulingHistory.shift();
      }
    } else {
      this.mindSchedulingHistory = [];
    }

    const thrashingDetected =
      this.mindSchedulingHistory.length === this.thrashingDepth &&
      this.mindSchedulingHistory.every((op) => op === 'SYS_EDIT' || op === 'SYS_MOVE');
    if (thrashingDetected) {
      this.mindSchedulingHistory = [];
      const trapDetails = [
        'TRAP_THRASHING triggered: excessive mind scheduling with no physical I/O.',
        `Consecutive ops: ${this.thrashingDepth} (${this.thrashingDepth}-tick window)`,
        'Requirement: issue SYS_WRITE or SYS_EXEC to produce physical progress before more SYS_EDIT/SYS_MOVE churn.',
      ].join('\n');
      return this.raiseManagedTrap(
        'sys://trap/thrashing',
        trapDetails,
        [
          q_next,
          '',
          '[OS_TRAP: THRASHING] Analysis paralysis detected.',
          'Consecutive SYS_EDIT/SYS_MOVE exceeded threshold with no SYS_WRITE/SYS_EXEC.',
          'Action: execute one physical step now (SYS_WRITE or SYS_EXEC), then continue scheduling.',
        ].join('\n'),
        q_next
      );
    }

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
      const trapDetails = [
        'WATCHDOG_NMI triggered: repeated identical action signature.',
        `Action signature: ${actionHash.slice(0, 12)}`,
        `Window: ${this.watchdogDepth}`,
      ].join('\n');
      return this.trapReturn(
        'sys://trap/watchdog',
        trapDetails,
        [
          '[OS_TRAP: WATCHDOG_NMI] INFINITE LOOP DETECTED!',
          'You repeated the same action 5 times with no progress.',
          'Pop current task, log why it failed, and attempt a different strategy.',
          '',
          '[RECOVERED STATE q]:',
          q_next,
        ].join('\n'),
        'sys://trap/watchdog',
        { source: 'watchdog', action_signature: actionHash.slice(0, 12), window: this.watchdogDepth }
      );
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
      const trapDetails = [
        'L1_CACHE_HIT triggered: repeated short-horizon action signature.',
        `Action signature: ${actionHash.slice(0, 12)}`,
        `Window: ${this.l1TraceDepth}`,
      ].join('\n');
      return this.trapReturn(
        'sys://trap/l1_cache_hit',
        trapDetails,
        [
          '[OS_TRAP: L1_CACHE_HIT] Repeated action detected in short horizon.',
          `Action signature: ${actionHash.slice(0, 12)}`,
          'Action: change strategy now (different pointer/command) or PUSH a diagnostic subtask.',
          '',
          '[RECOVERED STATE q]:',
          q_next,
        ].join('\n'),
        'sys://trap/l1_cache_hit',
        { source: 'l1_cache', action_signature: actionHash.slice(0, 12), window: this.l1TraceDepth }
      );
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
          return this.trapReturn(
            'sys://trap/io_fault',
            `Failed to write to ${writePointerTrimmed}: ${normalized.reason}`,
            [
              q_next,
              '',
              `[OS_TRAP: IO_FAULT] Failed to write to ${writePointerTrimmed}: ${normalized.reason}`,
              `Action: append exact line DONE:${nextRequiredDone ?? '<none>'} once.`,
            ].join('\n'),
            'sys://trap/io_fault',
            { source: 'normalize_progress', pointer: writePointerTrimmed }
          );
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
          return this.trapReturn(
            'sys://trap/content_contract',
            trapDetails,
            [
              q_next,
              '',
              '[OS_TRAP: CONTENT_CONTRACT_VIOLATION] Incomplete payload blocked.',
              `Details: ${trapDetails}`,
            ].join('\n'),
            this.systemTrapPointer('sys://trap/content_contract', trapDetails),
            { source: 'content_contract' }
          );
        }
      }

      try {
        await this.manifold.interfere(writePointerTrimmed, writePayload);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return this.trapReturn(
          'sys://trap/io_fault',
          `Failed to write to ${writePointerTrimmed}: ${message}`,
          [
            q_next,
            '',
            `[OS_TRAP: IO_FAULT] Failed to write to ${writePointerTrimmed}: ${message}`,
            'Push a task to fix permission or syntax issue and retry.',
          ].join('\n'),
          'sys://trap/io_fault',
          { source: 'manifold_write', pointer: writePointerTrimmed }
        );
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

  private async ensureReplayCursorLoaded(): Promise<void> {
    if (this.replayCursorLoaded) {
      return;
    }
    this.replayCursorLoaded = true;

    const reader = this.chronos.readReplayCursor;
    if (typeof reader !== 'function') {
      return;
    }

    try {
      const cursor = await reader.call(this.chronos);
      if (!cursor) {
        return;
      }
      const tickSeq =
        typeof cursor.tickSeq === 'number' && Number.isFinite(cursor.tickSeq) && cursor.tickSeq >= 0
          ? cursor.tickSeq
          : 0;
      const merkleRoot = typeof cursor.merkleRoot === 'string' && cursor.merkleRoot.length > 0
        ? cursor.merkleRoot
        : 'GENESIS';
      this.replayTupleSeq = tickSeq;
      this.replayMerkleRoot = merkleRoot;
    } catch {
      this.replayTupleSeq = 0;
      this.replayMerkleRoot = 'GENESIS';
    }
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

  private appendTrapFrameToState(state: State, frame: TrapFrame): State {
    const frameJson = JSON.stringify(frame);
    if (state.includes('[OS_TRAP_FRAME_JSON]')) {
      return state;
    }
    return [state, '', '[OS_TRAP_FRAME_JSON]', frameJson].join('\n');
  }

  private buildTrapFrame(
    trapBase: string,
    trapPointer: Pointer,
    details: string,
    metadata?: Record<string, unknown>
  ): TrapFrame {
    return {
      seq: this.trapFrameSeq++,
      ts: new Date().toISOString(),
      trap_base: trapBase,
      trap_pointer: trapPointer,
      details,
      panic_reset_count: this.panicResetCount,
      ...(metadata ? { metadata } : {}),
    };
  }

  private async trapReturn(
    trapBase: string,
    details: string,
    trapState: State,
    trapPointer: Pointer,
    metadata?: Record<string, unknown>
  ): Promise<[State, Pointer]> {
    const frame = this.buildTrapFrame(trapBase, trapPointer, details, metadata);
    await this.chronos.engrave(`[TRAP_FRAME] ${JSON.stringify(frame)}`);
    return [this.appendTrapFrameToState(trapState, frame), trapPointer];
  }

  private async panicResetFromLoop(trapBase: string, recoveredState: State): Promise<[State, Pointer]> {
    this.panicResetCount += 1;
    await this.resetCallStackBestEffort();

    if (this.panicResetCount > this.maxPanicResets) {
      const fatalDetails = [
        'Unrecoverable trap loop: panic reset budget exhausted.',
        `Repeated trap: ${trapBase}`,
        `Budget: ${this.maxPanicResets}`,
        'Action: hard-stop this run and require external intervention.',
      ].join('\n');
      this.lastTrapDetails.set('sys://trap/unrecoverable_loop', fatalDetails);
      return this.trapReturn(
        'sys://trap/unrecoverable_loop',
        fatalDetails,
        [
          '[OS_PANIC: UNRECOVERABLE_LOOP] Panic reset budget exhausted.',
          `Repeated trap: ${trapBase}`,
          `Budget: ${this.maxPanicResets}`,
          'Action: investigate trap frame log and restart with corrected strategy.',
        ].join('\n'),
        'HALT',
        { source: 'panic_reset_budget', repeated_trap: trapBase }
      );
    }

    const panicDetails = [
      'Kernel panic reset: repeated trap pointer loop detected.',
      `Repeated trap: ${trapBase}`,
      `Reset attempt: ${this.panicResetCount}/${this.maxPanicResets}`,
      'Action: abandon current approach and switch to a different diagnosis path immediately.',
    ].join('\n');
    this.lastTrapDetails.set('sys://trap/panic_reset', panicDetails);
    return this.trapReturn(
      'sys://trap/panic_reset',
      panicDetails,
      [
        '[OS_PANIC: INFINITE_LOOP_KILLED] Repeated trap loop interrupted.',
        `Repeated trap: ${trapBase}`,
        'Action: use a different pointer/command strategy and avoid the last failing function path.',
        '',
        '[RECOVERED STATE q]:',
        recoveredState,
      ].join('\n'),
      this.systemTrapPointer('sys://trap/panic_reset', panicDetails),
      { source: 'panic_reset', repeated_trap: trapBase }
    );
  }

  private async raiseManagedTrap(
    trapBase: string,
    details: string,
    trapState: State,
    recoveredState: State
  ): Promise<[State, Pointer]> {
    this.lastTrapDetails.set(trapBase, details);
    const pointer = this.systemTrapPointer(trapBase, details);
    const trapLoop = this.trackTrapPointerLoop(pointer);
    if (trapLoop.loop) {
      return this.panicResetFromLoop(trapLoop.trapBase, recoveredState);
    }

    this.panicResetCount = 0;
    return this.trapReturn(trapBase, details, trapState, pointer, { source: 'raise_managed_trap' });
  }

  private consumeOracleRouteTrace(): string | null {
    const withTelemetry = this.oracle as IOracle & {
      consumeLastRouteTrace?: () => Record<string, unknown> | null;
    };
    if (typeof withTelemetry.consumeLastRouteTrace !== 'function') {
      return null;
    }

    try {
      const payload = withTelemetry.consumeLastRouteTrace();
      if (!payload) {
        return null;
      }
      return JSON.stringify(payload);
    } catch {
      return null;
    }
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
      case 'SYS_GIT_LOG': {
        const summary: string[] = [];
        if (typeof syscall.limit === 'number') {
          summary.push(`limit=${syscall.limit}`);
        }
        if (typeof syscall.path === 'string' && syscall.path.trim().length > 0) {
          summary.push(`path=${syscall.path.trim().slice(0, 24)}`);
        }
        if (typeof syscall.ref === 'string' && syscall.ref.trim().length > 0) {
          summary.push(`ref=${syscall.ref.trim().slice(0, 24)}`);
        }
        if (typeof syscall.query_params === 'string' && syscall.query_params.trim().length > 0) {
          summary.push(`query=${syscall.query_params.trim().slice(0, 24)}`);
        }
        return `${syscall.op}(${summary.join(',') || 'default'})`;
      }
      case 'SYS_PUSH':
        return `${syscall.op}(${syscall.task.slice(0, 40)})`;
      case 'SYS_EDIT':
        return `${syscall.op}(${syscall.task.slice(0, 40)})`;
      case 'SYS_MOVE': {
        const summary: string[] = [];
        if (typeof syscall.task_id === 'string' && syscall.task_id.trim().length > 0) {
          summary.push(`task_id=${syscall.task_id.trim().slice(0, 24)}`);
        }
        if (typeof syscall.target_pos === 'string' && syscall.target_pos.trim().length > 0) {
          summary.push(`target_pos=${syscall.target_pos.trim().toUpperCase()}`);
        }
        if (typeof syscall.status === 'string' && syscall.status.trim().length > 0) {
          summary.push(`status=${syscall.status.trim().toUpperCase()}`);
        }
        return `${syscall.op}(${summary.join(',') || 'default'})`;
      }
      case 'SYS_POP':
      case 'SYS_HALT':
        return syscall.op;
      default: {
        const exhaustiveCheck: never = syscall;
        return `UNKNOWN(${JSON.stringify(exhaustiveCheck)})`;
      }
    }
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
    q_t: State,
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
    const frameBudget = this.computeOracleFrameBudget(q_t);
    const metaBudget = Math.max(256, Math.floor(frameBudget * 0.28));
    const contractBudget = Math.max(96, Math.floor(metaBudget * 0.4));
    const l1Budget = Math.max(64, Math.floor(metaBudget * 0.2));
    const callStackBudget = Math.max(96, metaBudget - contractBudget - l1Budget);
    const contract = this.clipFrameSection(
      'OS_CONTRACT',
      contractSlice,
      contractBudget,
      clippedSections
    );
    const l1Trace = this.clipFrameSection(
      'L1_TRACE_CACHE',
      l1TraceSlice,
      l1Budget,
      clippedSections
    );
    const callStack = this.clipFrameSection(
      'OS_CALL_STACK',
      callStackSlice,
      callStackBudget,
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
    const observedBudget = Math.max(
      this.oracleObservedMinChars,
      Math.max(0, frameBudget - prefix.length - 1)
    );
    const observed = this.clipFrameSection('OBSERVED_SLICE', observedSlice, observedBudget, clippedSections);
    const assembled = `${prefix}\n${observed}`;
    const fallback = this.applyOracleFrameHardLimit(assembled, frameBudget);
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

  private computeOracleFrameBudget(q_t: State): number {
    const requestBudget =
      Number.isFinite(this.oracleRequestCharBudget) && this.oracleRequestCharBudget > 0
        ? this.oracleRequestCharBudget
        : 8192;
    const dynamic = requestBudget - this.disciplinePrompt.length - q_t.length - this.oracleFrameSafetyMarginChars;
    return Math.min(this.oracleFrameHardLimitChars, Math.max(this.oracleFrameMinChars, dynamic));
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

  private applyOracleFrameHardLimit(frame: Slice, maxChars: number): {
    slice: Slice;
    truncated: boolean;
    originalLength: number;
    emittedLength: number;
    hash: string;
  } {
    const originalLength = frame.length;
    const hash = createHash('sha256').update(frame).digest('hex').slice(0, 16);
    if (originalLength <= maxChars) {
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
      `MaxChars=${maxChars}`,
      `OriginalChars=${originalLength}`,
      `FrameHash=${hash}`,
      'Action: use SYS_GOTO/SYS_EXEC to page through full evidence; this frame is clipped for O(1) safety.',
      '',
    ].join('\n');
    const footer = '\n\n[OS_FRAME_HARD_LIMIT_END]';
    const budget = Math.max(0, maxChars - header.length - footer.length);
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

      if (this.isTestCommand(command)) {
        this.pushVerificationSignal(`TEST:${command}`);
      } else if (this.isVerificationCommand(command)) {
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

  private isTestCommand(command: string): boolean {
    const normalized = command.toLowerCase();
    const patterns = [
      /\b(npm|pnpm|yarn)\s+(test|run\s+test)\b/,
      /\b(pytest|go\s+test|cargo\s+test|jest|vitest|ctest|mvn\s+test|gradle\s+test)\b/,
      /\btest\b/,
    ];
    return patterns.some((pattern) => pattern.test(normalized));
  }

  private checkRecentVerificationEvidence(): { ok: true } | { ok: false; reason: string } {
    const testSignals = this.recentVerificationSignals.filter((signal) => signal.startsWith('TEST:'));
    if (testSignals.length > 0) {
      return { ok: true };
    }

    const commandSignals = this.recentVerificationSignals.filter((signal) => signal.startsWith('CMD:'));
    return {
      ok: false,
      reason:
        commandSignals.length > 0
          ? 'No successful test command was observed. Require TEST:* signal (e.g., npm test/pytest/go test) with [EXIT_CODE] 0.'
          : 'No successful verification command was observed. Require TEST:* signal with [EXIT_CODE] 0.',
    };
  }

  private trackTrapPointerLoop(pointer: Pointer): { loop: false } | { loop: true; trapBase: string } {
    const trimmed = pointer.trim();
    if (!trimmed.startsWith('sys://trap/')) {
      this.trapPointerHistory = [];
      this.panicResetCount = 0;
      return { loop: false };
    }

    const trapBase = trimmed.split('?', 1)[0];
    this.trapPointerHistory.push(trapBase);
    if (this.trapPointerHistory.length > this.trapLoopDepth) {
      this.trapPointerHistory.shift();
    }

    if (this.trapPointerHistory.length >= 3) {
      const n = this.trapPointerHistory.length;
      const a = this.trapPointerHistory[n - 3];
      const b = this.trapPointerHistory[n - 2];
      const c = this.trapPointerHistory[n - 1];
      if (a === c && a !== b) {
        this.trapPointerHistory = [];
        return { loop: true, trapBase: `${a}->${b}->${c}` };
      }
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

  private async resetCallStackBestEffort(): Promise<void> {
    try {
      await this.manifold.interfere('sys://callstack', 'RESET');
    } catch {
      // Non-fatal panic path cleanup.
    }
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

  private composeGitLogPointer(
    syscall: Extract<
      Transition['a_t'],
      {
        op: 'SYS_GIT_LOG';
      }
    >
  ): Pointer {
    const params = new URLSearchParams();
    const add = (key: string, value: unknown): void => {
      if (typeof value !== 'string') {
        return;
      }
      const trimmed = value.trim();
      if (trimmed.length > 0) {
        params.set(key, trimmed);
      }
    };

    if (typeof syscall.limit === 'number' && Number.isFinite(syscall.limit) && syscall.limit > 0) {
      params.set('limit', String(Math.floor(syscall.limit)));
    }
    add('path', syscall.path);
    add('ref', syscall.ref);
    add('grep', syscall.grep);
    add('since', syscall.since);
    add('query_params', syscall.query_params);

    const query = params.toString();
    return query.length > 0 ? `sys://git/log?${query}` : 'sys://git/log';
  }
}

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
  private lastObservedPointer?: Pointer;
  private lastObservedSlice?: Slice;
  private lastTrapDetails = new Map<string, string>();

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
        const progressCheck = await this.executionContract.checkProgress();
        if (!progressCheck.ok) {
          const reason = progressCheck.reason ?? 'Unknown contract error.';
          const action = reason.includes('required file is missing')
            ? 'Action: Create the missing file for that DONE step first, then continue to next step.'
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

    // 2.5) HALT guard: block HALT unless acceptance contract is satisfied.
    const haltRequested = q_next.trim() === 'HALT' || d_next.trim() === 'HALT';
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

    // 3) Watchdog non-maskable interrupt against repeated actions.
    const actionHash = createHash('sha256')
      .update(`${d_next}|${s_prime.slice(0, 80)}`)
      .digest('hex');

    this.watchdogHistory.push(actionHash);
    if (this.watchdogHistory.length > 5) {
      this.watchdogHistory.shift();
    }

    const isStuck =
      this.watchdogHistory.length === 5 &&
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
      try {
        await this.manifold.interfere(d_t, s_prime);
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
    await this.chronos.engrave(`[Tick] d:${d_t} -> d':${d_next} | ${shortQ}`);

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
}

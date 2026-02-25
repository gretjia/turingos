import { createHash } from 'node:crypto';
import {
  IChronos,
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

  constructor(
    private manifold: IPhysicalManifold,
    private oracle: IOracle,
    private chronos: IChronos,
    private disciplinePrompt: string
  ) {}

  public async tick(q_t: State, d_t: Pointer): Promise<[State, Pointer]> {
    let s_t: Slice;

    // 1) Observe from the physical manifold.
    try {
      s_t = await this.manifold.observe(d_t);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      s_t = [
        `[OS_TRAP: PAGE_FAULT] Failed to observe coordinate ${d_t}.`,
        `Details: ${message}`,
        'Action: Create the resource or fix the pointer path in your next cycle.',
      ].join('\n');
    }

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
    if (s_prime.trim() !== '👆🏻' && !d_t.startsWith('sys://')) {
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
}

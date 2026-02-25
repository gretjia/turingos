import { IOracle, Slice, State, Transition } from '../kernel/types.js';

export class MockOracle implements IOracle {
  private step = 0;

  public async collapse(_discipline: string, q: State, s: Slice): Promise<Transition> {
    this.step += 1;

    if (this.step === 1) {
      return {
        q_next: 'q_1: MOCK_WRITE_FILE',
        a_t: {
          action_type: 'WRITE',
          s_prime: `${s}\n\n[MOCK] Bootstrapped by mock oracle.`
        },
        stack_op: 'NOP',
      };
    }

    if (this.step === 2) {
      return {
        q_next: [
          'q_2: MOCK_RECOVERY',
          '[x] observed command failure as data slice',
          `[x] stderr visible: ${s.includes('mock failure')}`,
        ].join('\n'),
        a_t: {
          action_type: 'GOTO',
          d_next: 'HALT'
        },
        stack_op: 'NOP',
      };
    }

    return {
      q_next: q,
      a_t: {
        action_type: 'GOTO',
        d_next: 'HALT'
      },
      stack_op: 'NOP',
    };
  }
}

import { IOracle, Slice, State, Transition } from '../kernel/types.js';

export class MockOracle implements IOracle {
  private step = 0;

  public async collapse(_discipline: string, q: State, s: Slice): Promise<Transition> {
    this.step += 1;

    if (this.step === 1) {
      return {
        q_next: 'q_1: MOCK_WRITE_FILE',
        a_t: {
          op: 'SYS_WRITE',
          payload: `${s}\n\n[MOCK] Bootstrapped by mock oracle.`,
        },
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
          op: 'SYS_HALT',
        },
      };
    }

    return {
      q_next: q,
      a_t: {
        op: 'SYS_HALT',
      },
    };
  }
}

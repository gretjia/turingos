import { IOracle, Slice, State, Transition } from '../kernel/types.js';

export class MockOracle implements IOracle {
  private step = 0;

  public async collapse(_discipline: string, q: State, s: Slice): Promise<Transition> {
    this.step += 1;

    if (this.step === 1) {
      return {
        q_next: 'q_1: MOCK_WRITE_FILE',
        s_prime: `${s}\n\n[MOCK] Bootstrapped by mock oracle.`,
        d_next: '$ node -e "console.error(\'mock failure\'); process.exit(1)"',
      };
    }

    if (this.step === 2) {
      return {
        q_next: [
          'q_2: MOCK_RECOVERY',
          '[x] observed command failure as data slice',
          `[x] stderr visible: ${s.includes('mock failure')}`,
        ].join('\n'),
        s_prime: '👆🏻',
        d_next: 'HALT',
      };
    }

    return {
      q_next: q,
      s_prime: '👆🏻',
      d_next: 'HALT',
    };
  }
}

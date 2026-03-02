import { IOracle, OracleCollapseOptions, Slice, State, Transition } from '../kernel/types.js';

export class RoundRobinOracle implements IOracle {
  private cursor = 0;

  constructor(private readonly oracles: IOracle[]) {
    if (oracles.length === 0) {
      throw new Error('RoundRobinOracle requires at least one oracle.');
    }
  }

  public async collapse(
    discipline: string,
    q: State,
    s: Slice,
    options?: OracleCollapseOptions
  ): Promise<Transition> {
    const oracle = this.pickNextOracle();
    return oracle.collapse(discipline, q, s, options);
  }

  private pickNextOracle(): IOracle {
    const oracle = this.oracles[this.cursor % this.oracles.length]!;
    this.cursor = (this.cursor + 1) % this.oracles.length;
    return oracle;
  }
}

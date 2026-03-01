import { BrainRole, IOracle, PCB, Slice, State, Transition } from '../kernel/types.js';

export interface DualBrainDispatchTrace {
  ts: string;
  pid: string;
  role: BrainRole;
  lane: 'P' | 'E';
  laneLabel: string;
  temperature: number;
}

interface DualBrainOracleConfig {
  plannerOracle: IOracle;
  workerOracle: IOracle;
  plannerLabel?: string;
  workerLabel?: string;
}

export class DualBrainOracle {
  private lastTrace: DualBrainDispatchTrace | null = null;

  constructor(private readonly config: DualBrainOracleConfig) {}

  public async dispatchTick(
    pcb: Pick<PCB, 'pid' | 'role' | 'temperature'>,
    discipline: string,
    q: State,
    s: Slice
  ): Promise<Transition> {
    const planner = pcb.role === 'PLANNER';
    const lane: 'P' | 'E' = planner ? 'P' : 'E';
    const laneLabel = planner
      ? this.config.plannerLabel ?? 'planner_lane'
      : this.config.workerLabel ?? 'worker_lane';
    const oracle = planner ? this.config.plannerOracle : this.config.workerOracle;

    this.lastTrace = {
      ts: new Date().toISOString(),
      pid: pcb.pid,
      role: pcb.role,
      lane,
      laneLabel,
      temperature: pcb.temperature,
    };
    return oracle.collapse(discipline, q, s, { temperature: pcb.temperature });
  }

  public consumeLastTrace(): DualBrainDispatchTrace | null {
    const trace = this.lastTrace;
    this.lastTrace = null;
    return trace;
  }
}

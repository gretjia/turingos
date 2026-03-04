import { BrainRole, IOracle, PCB, Slice, State, Transition } from '../kernel/types.js';
import { CognitiveProfile } from './cognitive-router.js';

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
  private readonly traceByPid = new Map<string, DualBrainDispatchTrace>();

  constructor(private readonly config: DualBrainOracleConfig) {}

  public async dispatchTick(
    pcb: Pick<PCB, 'pid' | 'role' | 'temperature'>,
    discipline: string,
    q: State,
    s: Slice,
    options?: Partial<CognitiveProfile>,
    signal?: AbortSignal
  ): Promise<Transition> {
    const planner = pcb.role === 'PLANNER';
    const lane: 'P' | 'E' = planner ? 'P' : 'E';
    const laneLabel = planner
      ? this.config.plannerLabel ?? 'planner_lane'
      : this.config.workerLabel ?? 'worker_lane';
    const oracle = planner ? this.config.plannerOracle : this.config.workerOracle;

    const trace: DualBrainDispatchTrace = {
      ts: new Date().toISOString(),
      pid: pcb.pid,
      role: pcb.role,
      lane,
      laneLabel,
      temperature: options?.temperature ?? pcb.temperature,
    };
    this.traceByPid.set(pcb.pid, trace);
    return oracle.collapse(discipline, q, s, { temperature: pcb.temperature, ...options }, signal);
  }

  public consumeLastTrace(pid?: string): DualBrainDispatchTrace | null {
    if (pid) {
      const trace = this.traceByPid.get(pid) ?? null;
      if (trace) {
        this.traceByPid.delete(pid);
      }
      return trace;
    }
    const first = this.traceByPid.entries().next();
    if (first.done) {
      return null;
    }
    const [firstPid, trace] = first.value;
    this.traceByPid.delete(firstPid);
    return trace;
  }
}

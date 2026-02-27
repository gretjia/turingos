import { IOracle, Slice, State, Transition } from '../kernel/types.js';

type DispatcherLane = 'P' | 'E';
type InstructionClass =
  | 'WORLD_MUTATION'
  | 'WORLD_NAVIGATION'
  | 'MIND_SCHEDULING'
  | 'SYSTEM_CONTROL'
  | 'UNKNOWN';

interface LaneStats {
  attempts: number;
  successes: number;
  failures: number;
  consecutiveFailures: number;
}

interface RouteTrace {
  seq: number;
  ts: string;
  lane: DispatcherLane;
  lane_label: string;
  preferred_lane: DispatcherLane;
  preferred_lane_label: string;
  reason: string;
  predicted_class: InstructionClass;
  actual_class?: InstructionClass;
  actual_op?: string;
  selected_health: number;
  alternate_health: number;
  failover_from?: DispatcherLane;
}

interface DispatcherOracleConfig {
  pOracle: IOracle;
  eOracle: IOracle;
  pLaneLabel?: string;
  eLaneLabel?: string;
  minHealthyScore?: number;
  switchMargin?: number;
}

interface RouteDecision {
  preferredLane: DispatcherLane;
  lane: DispatcherLane;
  reason: string;
  predictedClass: InstructionClass;
  selectedHealth: number;
  alternateHealth: number;
}

const DEFAULT_TRAP_PATTERN =
  /\[OS_TRAP:|\[OS_PANIC:|TRAP_THRASHING|CPU_FAULT|WATCHDOG_NMI|L1_CACHE_HIT|UNRECOVERABLE_LOOP/i;

function classifyFromOp(op: string): InstructionClass {
  if (op === 'SYS_WRITE' || op === 'SYS_EXEC') {
    return 'WORLD_MUTATION';
  }
  if (op === 'SYS_GOTO' || op === 'SYS_GIT_LOG') {
    return 'WORLD_NAVIGATION';
  }
  if (op === 'SYS_PUSH' || op === 'SYS_POP' || op === 'SYS_EDIT' || op === 'SYS_MOVE') {
    return 'MIND_SCHEDULING';
  }
  if (op === 'SYS_HALT') {
    return 'SYSTEM_CONTROL';
  }
  return 'UNKNOWN';
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

export class DispatcherOracle implements IOracle {
  private readonly minHealthyScore: number;
  private readonly switchMargin: number;
  private readonly stats: Record<DispatcherLane, LaneStats> = {
    P: { attempts: 0, successes: 0, failures: 0, consecutiveFailures: 0 },
    E: { attempts: 0, successes: 0, failures: 0, consecutiveFailures: 0 },
  };
  private routeSeq = 0;
  private lastTrace: RouteTrace | null = null;

  constructor(private readonly config: DispatcherOracleConfig) {
    this.minHealthyScore = config.minHealthyScore ?? 0.45;
    this.switchMargin = config.switchMargin ?? 0.15;
  }

  public async collapse(discipline: string, q: State, s: Slice): Promise<Transition> {
    const decision = this.decide(q, s);

    try {
      const transition = await this.callLane(decision.lane, discipline, q, s);
      this.recordTrace(decision, transition, undefined);
      return transition;
    } catch (error: unknown) {
      if (decision.lane === 'E') {
        // Deterministic failover: routine lane failure escalates to P lane.
        const failoverReason = this.renderError(error);
        const failoverDecision: RouteDecision = {
          preferredLane: decision.preferredLane,
          lane: 'P',
          reason: `${decision.reason}; runtime_failover_from=E`,
          predictedClass: decision.predictedClass,
          selectedHealth: this.laneHealth('P'),
          alternateHealth: this.laneHealth('E'),
        };
        const transition = await this.callLane('P', discipline, q, s);
        this.recordTrace(failoverDecision, transition, 'E', failoverReason);
        return transition;
      }
      throw error;
    }
  }

  public consumeLastRouteTrace(): RouteTrace | null {
    const current = this.lastTrace;
    this.lastTrace = null;
    return current;
  }

  private laneLabel(lane: DispatcherLane): string {
    if (lane === 'P') {
      return this.config.pLaneLabel ?? 'P-Core';
    }
    return this.config.eLaneLabel ?? 'E-Core';
  }

  private decide(q: State, s: Slice): RouteDecision {
    const trapContext = DEFAULT_TRAP_PATTERN.test(`${q}\n${s}`);
    const blockedContext = /\[NEXT_REQUIRED_STATUS\]\s*BLOCKED/i.test(s);
    const predictedClass: InstructionClass = trapContext || blockedContext ? 'MIND_SCHEDULING' : 'WORLD_MUTATION';
    const preferredLane: DispatcherLane = trapContext || blockedContext ? 'P' : 'E';
    const alternate: DispatcherLane = preferredLane === 'P' ? 'E' : 'P';
    const preferredHealth = this.laneHealth(preferredLane);
    const alternateHealth = this.laneHealth(alternate);
    const unhealthy = preferredHealth < this.minHealthyScore;
    const alternateBetter = alternateHealth >= preferredHealth + this.switchMargin;
    const lane = unhealthy && alternateBetter ? alternate : preferredLane;
    const reason = trapContext
      ? 'trap_context'
      : blockedContext
        ? 'blocked_context'
        : unhealthy && alternateBetter
          ? 'health_fallback'
          : 'routine_context';

    return {
      preferredLane,
      lane,
      reason,
      predictedClass,
      selectedHealth: lane === preferredLane ? preferredHealth : alternateHealth,
      alternateHealth: lane === preferredLane ? alternateHealth : preferredHealth,
    };
  }

  private laneHealth(lane: DispatcherLane): number {
    const stat = this.stats[lane];
    const base = (stat.successes + 1) / (stat.attempts + 2);
    const penalty = Math.min(0.3, stat.consecutiveFailures * 0.08);
    return Number(clamp01(base - penalty).toFixed(4));
  }

  private async callLane(
    lane: DispatcherLane,
    discipline: string,
    q: State,
    s: Slice
  ): Promise<Transition> {
    const oracle = lane === 'P' ? this.config.pOracle : this.config.eOracle;
    this.stats[lane].attempts += 1;
    try {
      const transition = await oracle.collapse(discipline, q, s);
      this.stats[lane].successes += 1;
      this.stats[lane].consecutiveFailures = 0;
      return transition;
    } catch (error: unknown) {
      this.stats[lane].failures += 1;
      this.stats[lane].consecutiveFailures += 1;
      throw error;
    }
  }

  private renderError(error: unknown): string {
    if (error instanceof Error) {
      return `${error.name}: ${error.message}`;
    }
    return String(error);
  }

  private recordTrace(
    decision: RouteDecision,
    transition: Transition,
    failoverFrom?: DispatcherLane,
    failoverError?: string
  ): void {
    const op = transition.a_t?.op ?? 'UNKNOWN';
    const trace: RouteTrace = {
      seq: this.routeSeq,
      ts: new Date().toISOString(),
      lane: decision.lane,
      lane_label: this.laneLabel(decision.lane),
      preferred_lane: decision.preferredLane,
      preferred_lane_label: this.laneLabel(decision.preferredLane),
      reason: failoverError ? `${decision.reason}; failover_error=${failoverError}` : decision.reason,
      predicted_class: decision.predictedClass,
      actual_class: classifyFromOp(op),
      actual_op: op,
      selected_health: decision.selectedHealth,
      alternate_health: decision.alternateHealth,
      ...(failoverFrom ? { failover_from: failoverFrom } : {}),
    };
    this.routeSeq += 1;
    this.lastTrace = trace;
  }
}

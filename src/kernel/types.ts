export type State = string;
export type Pointer = string;
export type Slice = string;
export type RunqueueStatus = 'ACTIVE' | 'SUSPENDED' | 'BLOCKED';
export type RunqueueTargetPos = 'TOP' | 'BOTTOM';
export type ProcessState = 'READY' | 'RUNNING' | 'BLOCKED' | 'PENDING_HALT' | 'TERMINATED' | 'KILLED';
export type BrainRole = 'PLANNER' | 'WORKER';

export interface PCB {
  pid: string;
  ppid: string | null;
  state: ProcessState;
  role: BrainRole;
  temperature: number;
  price: number;
  redFlags: number;
  chronos: Array<Record<string, unknown>>;
  registers: Record<string, unknown>;
  waitPids: Set<string>;
  mailbox: string[];
  exitOutput?: string;
}

export type Syscall =
  | { op: 'SYS_WRITE'; payload: string; semantic_cap?: Pointer }
  | { op: 'SYS_GOTO'; pointer: Pointer }
  | { op: 'SYS_EXEC'; cmd: string }
  | {
      op: 'SYS_GIT_LOG';
      query_params?: string;
      path?: Pointer;
      limit?: number;
      ref?: string;
      grep?: string;
      since?: string;
    }
  | { op: 'SYS_PUSH'; task: string }
  | { op: 'SYS_EDIT'; task: string }
  | {
      op: 'SYS_MOVE';
      task_id?: string;
      target_pos?: RunqueueTargetPos;
      status?: RunqueueStatus;
    }
  | { op: 'SYS_MAP_REDUCE'; tasks: string[] }
  | { op: 'SYS_POP' }
  | { op: 'SYS_HALT' };

export interface Transition {
  thought?: string;
  q_next: State;
  // Compatibility field for legacy analytics/tests; anti-oreo v2 runtime does not rely on a_t-only frames.
  a_t: Syscall;
  // VLIW-style optional channels: execute all mind_ops first, then at most one world_op.
  mind_ops?: Syscall[];
  world_op?: Syscall | null;
  // Parser may preserve raw world-op candidates for causality assertions in kernel.
  world_ops?: Syscall[];
}

export interface OracleCollapseOptions {
  temperature?: number;
}

export interface IOracle {
  collapse(discipline: string, q: State, s: Slice, options?: OracleCollapseOptions): Promise<Transition>;
}

export interface IPhysicalManifold {
  observe(pointer: Pointer): Promise<Slice>;
  interfere(pointer: Pointer, payload: string): Promise<void>;
}

export interface IChronos {
  engrave(entry: string): Promise<void>;
  readReplayCursor?(): Promise<{ tickSeq: number; merkleRoot: string } | null>;
}

export interface ContractCheckResult {
  ok: boolean;
  reason?: string;
}

export interface IExecutionContract {
  checkProgress(): Promise<ContractCheckResult>;
  checkHalt(): Promise<ContractCheckResult>;
  checkNextRequiredStepReady(): Promise<ContractCheckResult>;
  getNextRequiredStep(): Promise<string | null>;
  getProgressPath(): string;
  getNextRequiredFileHint(): Promise<string | null>;
}

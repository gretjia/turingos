export type State = string;
export type Pointer = string;
export type Slice = string;
export type RunqueueStatus = 'ACTIVE' | 'SUSPENDED' | 'BLOCKED';
export type RunqueueTargetPos = 'TOP' | 'BOTTOM';

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
  | { op: 'SYS_POP' }
  | { op: 'SYS_HALT' };

export interface Transition {
  thought?: string;
  q_next: State;
  a_t: Syscall;
}

export interface IOracle {
  collapse(discipline: string, q: State, s: Slice): Promise<Transition>;
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

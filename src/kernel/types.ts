export type State = string;
export type Pointer = string;
export type Slice = string;

export type StackOp = 'PUSH' | 'POP' | 'NOP';

export interface Transition {
  thought?: string;
  q_next: State;
  s_prime: string;
  d_next: Pointer;
  stack_op: StackOp;
  stack_payload?: string;
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

export type State = string;
export type Pointer = string;
export type Slice = string;

export interface Transition {
  q_next: State;
  s_prime: string;
  d_next: Pointer;
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

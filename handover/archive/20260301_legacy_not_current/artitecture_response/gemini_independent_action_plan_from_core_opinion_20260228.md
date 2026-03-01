Here is the implementation action plan for TuringOS v2.0, strictly adhering to the Anti-Oreo (⚪⚫⚪) architecture and the provided constraints.

# TuringOS v2.0 Hyper-Core Implementation Action Plan

## 1. Goals
- **Architectural Shift**: Transition TuringOS from a monolithic, single-threaded `while(true)` loop to a Time-Sliced, Process Control Block (PCB) based scheduling system.
- **Isolate Intelligence**: Implement the Heterogeneous Dual-Brain structure (`PLANNER` for high-level logic, `WORKER` for isolated, deterministic execution) to prevent context pollution and hallucination loops.
- **White-Box Verification**: Replace LLM-based outcome valuation with deterministic, binary "Pricing" (Pass/Fail) at the top-level OS layer.

## 2. Non-negotiables
- **Strict ⚪⚫⚪ Layering**:
  - **⚪ Top White-Box**: `TuringHyperCore` scheduler. Maintains state, PCB, and enforces `SYS_HALT` traps. Zero LLM valuation.
  - **⚫ Middle Black-Box**: Dual-Brain Oracle (`PLANNER` @ Temp 0.7, `WORKER` @ Temp 0.0). Contexts are physically isolated.
  - **⚪ Bottom White-Box**: Deterministic Syscall Engine.
- **Absolute HALT Policy**: The `SYS_HALT` test standard MUST be co-defined exactly once by Human + AI at system initialization. Once initialized, **NO human participation** is permitted in `SYS_HALT` decisions. The top white-box verifier executes the predefined standard automatically and cold-rejects failures.
- **Red Flag Law**: Any Worker accumulating 3 formatting/syntax errors is unconditionally killed and penalized.

---

## 3. Phase Plan (Concrete File-Level Changes)

### Phase 1: OS Data Structures & Schema Protocol
**Target Files:** `src/kernel/types.ts`, `schemas/syscall-frame.v5.json`
1. **Extend `types.ts`**:
   - Define `ProcessState` (`READY`, `RUNNING`, `BLOCKED`, `PENDING_HALT`, `TERMINATED`, `KILLED`).
   - Define `BrainRole` (`PLANNER`, `WORKER`).
   - Introduce the `PCB` interface tracking `pid`, `ppid`, `price`, `redFlags`, `waitPids`, `mailbox`, and the isolated `chronos` memory array.
2. **Update `syscall-frame.v5.json`**:
   - Inject the `SYS_MAP_REDUCE` schema to allow the `PLANNER` to fork `WORKER` processes.

### Phase 2: Middle Black-Box (Dual-Brain Gateway)
**Target Files:** `src/oracle/dual-brain-oracle.ts` (New), `src/oracle/dispatcher-oracle.ts` (Refactor)
1. **Create `dual-brain-oracle.ts`**:
   - Implement `dispatchTick(pcb: PCB)` logic.
   - Route `BrainRole.PLANNER` to the cloud model endpoint with `Temperature = 0.7`.
   - Route `BrainRole.WORKER` to the local/sandboxed model endpoint with `Temperature = 0.0`.

### Phase 3: Top White-Box (Scheduler Migration)
**Target Files:** `src/kernel/scheduler.ts` (New), `src/kernel/engine.ts` (Deprecate/Migrate)
1. **Implement `TuringHyperCore` in `scheduler.ts`**:
   - Replace the legacy `engine.ts` single loop with an event-driven `runEventLoop()`.
   - Implement `spawn()` to initialize PCBs and place them in a `readyQueue`.
   - Implement context switching: pull `READY` tasks, call the Oracle, and route to `executeDeterministicSyscall`.
2. **Implement Trap & Fork Mechanisms**:
   - `routeSyscall`: Intercept `SYS_MAP_REDUCE` to fork workers and transition parent to `BLOCKED`.
   - `routeSyscall`: Intercept `SYS_HALT` to transition worker to `PENDING_HALT`.
3. **Implement Objective Pricing**:
   - Replace the architect's `readline` manual prompt with `child_process.execSync(globalHaltStandardCommand)`.
   - Implement `topWhiteBoxPricingLoop` to execute the automated test. On Pass: `price += 1` and `TERMINATED`. On Fail: `price -= 1`, reject `SYS_HALT`, append stderr to Worker's chronos, and force retry.

### Phase 4: Initialization & HALT Policy Lock-in
**Target Files:** `src/bench/pilot.ts` or main entry point
1. **Initialization Handshake**:
   - During boot, prompt the Human + AI to define the exact validation command (e.g., `npm run test:target` or a specific verification script).
   - Lock this command into the `TuringHyperCore` singleton.
2. **Execution Phase**:
   - Boot the scheduler. Disable all standard input prompts for HALT verification.

---

## 4. Acceptance Checks
- [ ] **Deprecation**: `src/kernel/engine.ts` is fully bypassed; the system runs exclusively on `scheduler.ts`.
- [ ] **Isolation**: Inspecting runtime logs confirms that `PLANNER` memory (`chronos`) never contains the intermediate crash logs or iterations of a `WORKER`.
- [ ] **Forking**: `SYS_MAP_REDUCE` successfully spawns $>1$ worker PIDs, and the `PLANNER` successfully halts execution until all workers resolve.
- [ ] **Automated HALT**: Triggering `SYS_HALT` automatically runs the pre-defined initialization test script. It correctly penalizes and resumes a Worker upon a simulated test failure without human prompts.
- [ ] **Red Flags**: Simulating 3 malformed JSON returns from a Worker correctly triggers the `KILLED` state and propagates a failure message to the `PLANNER`'s mailbox.

---

## 5. Risks
1. **Infinite Rejection Loop**: A Worker might repeatedly fail the automated `SYS_HALT` test, infinitely draining system resources.
   - *Control*: Introduce a `MAX_RETRIES` parameter in the PCB. If `price` drops below a certain threshold, kill the Worker and notify the Planner.
2. **Context Bloat on Join**: If 50 Workers return massive stdout blocks upon passing, the `PLANNER`'s `mailbox` could exceed token limits upon waking up.
   - *Control*: Enforce a strict `MAX_OUTPUT_LENGTH` on the `exitOutput` field during the Reduce phase.
3. **Flaky Initialization Tests**: If the human/AI co-defined HALT test is flaky, valid code will be rejected.
   - *Control*: Run a mandatory "dry-run" baseline of the test standard during initialization before locking it in.

## 6. Rollback Policy
- **Feature Flagging**: The migration will be hidden behind a `USE_HYPERCORE_V2=true` environment variable. The legacy `engine.ts` remains intact during deployment.
- **Gate 1 (Boot Failure)**: If the new `scheduler.ts` fails to boot or parse `syscall-frame.v5.json`, system automatically falls back to `v4` schema and legacy `engine.ts`.
- **Gate 2 (Deadlock)**: If the `readyQueue` is empty but `hasActiveProcesses()` remains true for >60 seconds (indicating a Map-Reduce deadlock), the core dumps the state, alerts the user, and aborts the run, enabling an immediate revert to the legacy single-threaded engine.

## 7. Final Completion Gate (Locked)
- Paper-aligned final criterion: `https://arxiv.org/html/2511.09030v1`
- Must satisfy both:
  1. `steps >= 1,000,000`
  2. final answer correctness is objectively verified
- If not satisfied: mark cycle as `NOT DONE`, continue debugging/hardening/training.

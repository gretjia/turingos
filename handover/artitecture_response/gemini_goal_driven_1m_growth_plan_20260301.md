### 1) Gemini Verdict

The failure of the 1M-step baseline at case 1102 due to a schema violation (returning an expression instead of a bare integer) indicates a systemic over-reliance on prompt compliance rather than strict system-level enforcement. To achieve Goal A (no-drift infinite execution) and Goal B (collective intelligence scaling), TuringOS must transition from a probabilistic text-generation paradigm to a deterministic, state-machine-driven architecture. The 1M test campaign must operate as a continuous fuzzing engine, utilizing strict constrained decoding, stateless worker framing, and an immutable event-sourcing state manager to guarantee that malformed outputs trigger automated rollbacks rather than state corruption.

### 2) Design Pillars

*   **System-Enforced Constrained Decoding:** Discard prompt-based formatting rules in favor of strict grammar/regex constraints (e.g., JSON schema, `^[0-9]+$`) enforced at the API/inference client level.
*   **Stateless Framing:** Workers must operate as pure functions. Context is explicitly passed per invocation, and no local memory or history is retained across tasks. 
*   **Red-Flag Interrupts:** Any deviation from expected latency, schema, or resource usage bounds triggers an immediate OS-level SIGKILL to the worker process, marking the proposal as tainted.
*   **Deterministic Rollback Discipline:** Global state (`rootState`) must be immutable and append-only. Failures trigger an automatic, immediate rollback to the $N-1$ verified checkpoint.
*   **Separation of Execution and Verification:** Planners synthesize and verify; workers propose. Proposals are only merged into `rootState` after passing independent deterministic validation or multi-worker consensus.

### 3) Stage Gates

*   **G0: Deterministic Output Enforcement**
    *   *Entry Criteria:* Current baseline code.
    *   *Exit Metrics:* 10,000 steps with 0 schema violations (all `ANSWER.txt` writes are strictly type-checked bare integers).
    *   *Rollback Trigger:* Any unhandled parsing or validation error in worker output.
*   **G1: Stateless Worker Resilience**
    *   *Entry Criteria:* G0 passed. Workers refactored to pure stateless execution.
    *   *Exit Metrics:* 50,000 steps completed; worker crash rate < 0.1% with zero impact on planner state.
    *   *Rollback Trigger:* Detection of memory leaks in worker processes > 100MB over baseline, or localized timeout > 30s.
*   **G2: Continuous Rollback & Resume**
    *   *Entry Criteria:* G1 passed. Append-only event sourcing implemented on `omega-vm`.
    *   *Exit Metrics:* 100,000 steps completed; 50 injected chaotic worker failures successfully caught, rolled back, and auto-resumed.
    *   *Rollback Trigger:* Failure of the orchestrator to resume from a state snapshot within 10 seconds of an injected fault.
*   **G3: Collective Intelligence Scaling**
    *   *Entry Criteria:* G2 passed. Multi-worker consensus routing implemented.
    *   *Exit Metrics:* 500,000 steps completed; statistical increase in pass@1 accuracy on a 1k evaluation subset via majority voting.
    *   *Rollback Trigger:* Planner deadlock waiting for worker consensus exceeding 5 minutes.
*   **G4: 1M Step Singularity**
    *   *Entry Criteria:* G3 passed. Telemetry and state management hardened for extended uptime.
    *   *Exit Metrics:* >=1,000,000 steps completed; deterministic final answer is exact; `rootState` terminates cleanly with status `DONE`.
    *   *Rollback Trigger:* Any semantic drift detected via calibration tasks, or state divergence between Mac and Windows worker lanes.

### 4) Worker Scaling Policy

A statically fixed pool of 16 workers creates bottlenecks for parallel tree-search and wastes resources on linear tasks.

*   **Policy:** Dynamic scaling managed by the Mac planner lane based on queue depth and task branching factor.
*   **Logic:** Deterministic/linear sub-tasks map to 1 worker. High-branching or high-ambiguity tasks scale to $N$ workers (Best-of-N consensus). If the `rootState` queue wait time exceeds $T_{max}$, the planner provisions additional workers across Mac/Windows lanes up to hardware limits. Idle workers are terminated after 5 minutes.
*   **Kill-Switch Condition:** If aggregate token consumption exceeds `MAX_TOKENS_PER_MINUTE` or API error rate exceeds 5% over a 60-second trailing window, immediately freeze scaling, suspend all active workers, and trigger a global system alert to `omega-vm`.

### 5) Failure-Resume Protocol

The run-until-fail loop must execute autonomously without human intervention:

1.  **Detect:** Inference client throws a schema validation error, worker times out, or a red-flag interrupt is triggered.
2.  **Halt:** Planner suspends all peer workers operating on the current sub-task branch.
3.  **Isolate:** Worker process is SIGKILLed. The malformed output is discarded.
4.  **Rollback:** `omega-vm` reverts `rootState` to the last cryptographically verified checkpoint.
5.  **Reframe:** Planner dynamically adjusts the task payload (e.g., injecting the validation error trace or reducing task scope).
6.  **Resume:** A fresh worker is provisioned and assigned the reframed task.
*   **Kill-Switch Condition:** If the exact same sub-task fails 3 consecutive times post-reframing, halt the orchestrator, dump core state, and enter `MANUAL_OVERRIDE` mode.

### 6) Top 5 Risks

1.  **Risk:** Format Violation Poisoning (e.g., Case 1102).
    *   *Mitigation:* System-level constrained decoding (JSON schema or regex enforcement at the inference API layer). Reject malformed responses before they reach the planner context.
2.  **Risk:** Semantic Drift and Context Exhaustion.
    *   *Mitigation:* Strict stateless framing. Workers receive only the precise sub-task context. The planner maintains history via a compressed, append-only log, not via raw LLM context windows.
3.  **Risk:** Uncaught Worker Infinite Loops.
    *   *Mitigation:* Hard wall-clock timeouts for all worker sub-processes and strict `max_tokens` limits on all inference calls.
4.  **Risk:** Planner State Corruption.
    *   *Mitigation:* Planners write state mutations to an append-only log with cryptographic hashing. In-memory state is continuously validated against log hashes.
5.  **Risk:** API Rate Limit or Hardware Resource Exhaustion.
    *   *Mitigation:* Implementation of exponential backoff at the inference layer and the dynamic worker scaling policy to aggressively reap idle processes.

### 7) Next 72h Execution

*   [ ] `git checkout -b feature/strict-decoding-enforcement`
*   [ ] Update inference client wrappers to enforce constrained decoding (e.g., `response_format` schemas for specific terminal states).
*   [ ] Write automated test: `test_case_1102_reproduction` asserting that an expression output string is rejected by the API client and triggers a local retry, preventing `ANSWER.txt` corruption.
*   [ ] Implement `rollback_to_checkpoint(step_id)` in `omega-vm` state manager.
*   [ ] Modify worker execution loops to trap SIGTERM/SIGKILL cleanly and report failure status to the orchestrator queue.
*   [ ] Execute `make test-g0-gate` (simulated 10k steps with injected format noise).
*   [ ] Deploy updated binaries to Mac planner and Mac/Windows worker lanes via Tailscale.
*   [ ] Initiate G1 validation run: `nohup ./turingos-orchestrator --target-steps 50000 --strict-mode > run.log 2>&1 &`

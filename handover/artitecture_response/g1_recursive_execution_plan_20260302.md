# G1 Recursive Execution Plan (DeepThink Audit Synthesis) - 2026-03-02

## 1. Context & Objective
Following the completion of the P1-P3 stabilization (G0 Phase), Gemini DeepThink provided a mathematical audit highlighting severe remaining theoretical bottlenecks (Format Hallucination probabilty, Swarm Entropy collapse, Tape Creep, and Period-N Attractors). 

To proceed, I dispatched an independent `gemini -y` agent to read the DeepThink directive and propose a concrete code-level plan. I have merged its proposals with my own architectural understanding into this final, recursively audited execution plan.

## 2. Plan Discussion & Synthesis

### Q1. Hard Grammar Constraints (FSM Logit-Masking)
*   **DeepThink Directive:** Shift Mac Planner to `llama.cpp` server and strictly pass GBNF to achieve $P=0$ format drift.
*   **Independent Agent Proposal:** Modify `universal-oracle.ts` to detect `llama.cpp` and inject `grammar: SYS_SCHEMA_GBNF` during the `/v1/chat/completions` API payload.
*   **Synthesis & Audit:** The proposal is solid. We will decouple the Mac from the Ollama wrapper, install the raw `llama-server` binary, and translate `TuringTransitionFrameSchema` into a rigorous GBNF string. This moves the format constraint from "prompt space" to "logit space," guaranteeing mathematical schema compliance.

### Q2. Proving Axiom 2 (Temperature Dithering & Ensemble Lift)
*   **DeepThink Directive:** Inject temperature dithering ($T=0.1$ to $0.7$) to maximize Swarm Entropy and track $W_{acc}$, Swarm Entropy ($H$), $E_{oracle}$, and $P_{lift}$.
*   **Independent Agent Proposal:** In `scheduler.ts`, dynamically offset the temperature of each spawned `WORKER` process (e.g., `0.7 + ((index - 8) * 0.025)`).
*   **Synthesis & Audit:** Dithering is essential. However, we will implement this safely inside the `scheduler.ts` map-reduce spawning logic, assigning a randomized or staggered temperature array to the 16 Windows worker processes. We will also add explicit JSON logging in `million-baseline-compare.ts` to track how often the consensus overrules an individual worker's error.

### Q3. Memory Array Truncations (Fixing Tape Creep)
*   **DeepThink Directive:** Upon rollback, physically truncate the LLM conversation memory to $S_{t-1}$ so it wakes up with zero memory of the crash, receiving only a deterministic failure token.
*   **Independent Agent Proposal:** Synchronize the `.micro_snapshot.tmp` rollback explicitly with the `q` (mind) state memory truncation.
*   **Synthesis & Audit:** The current `engine.ts` merely appends `[SYS_ERROR]` to the *polluted* state. We must rewrite the catch block in `tick()` so that when an unrecoverable World Op fails, `engine.ts` rolls back the filesystem AND resets `q` strictly to `q_t` (the exact memory string *before* the action was dispatched), appending only `[SYSTEM: PREVIOUS_WORLD_OP_FAILED_AT_EXECUTION]`.

### Q4. Period-N Semantic Collapses (Merkle Tree)
*   **DeepThink Directive:** Hash the workspace at step N. Keep a 50-step sliding window. If `Current_Hash` $\in$ `Historical_Hashes`, trigger a RED FLAG.
*   **Independent Agent Proposal:** Keep a sliding array `merkleHashWindow` inside the `PCB` and hash `q + d` on every transition.
*   **Synthesis & Audit:** We will implement an `L2_Trace_Cache` inside `engine.ts`. We will hash `(q_t + s_t + d_t)` at the beginning of every `tick()`. If this exact hash appears twice in a 50-step window, we inject `[OS_PANIC: PERIOD_N_LOOP_DETECTED]`.

### Q5. P85 Quorum Yield Barrier
*   **DeepThink Directive:** Eagerly proceed when 85% of workers return, culling the stragglers to prevent Amdahl's Law tail-latency blockages.
*   **Independent Agent Proposal:** Modify `resolveJoin` in `scheduler.ts` to trigger the tally when `mailbox.length >= Math.ceil(waitPids.size * 0.85)`. Kill the rest.
*   **Synthesis & Audit:** We will implement this directly in `scheduler.ts`'s `topWhiteBoxPricingLoop`. When checking if a parent `PLANNER` should be unblocked from a map-reduce, we will evaluate if `(completed_workers / total_workers) >= 0.85`. If so, we forcefully `KILLED` the remaining child PIDs and proceed with the majority consensus of the 85%.

## 3. Final Verdict (Released for Execution)
The execution paths are fully validated against the Twin Axioms. The plan is **APPROVED**. I will now begin the physical code modifications for G1.
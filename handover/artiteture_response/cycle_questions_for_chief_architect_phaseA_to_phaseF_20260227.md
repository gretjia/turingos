# Current Cycle Questions for Chief Architect (Phase A -> Phase F)

## Scope
- This question set covers the full current cycle since the latest architect reply.
- Coverage includes: `Phase A`, `Phase B`, `Phase C`, `Phase D`, `Phase E`, and `Phase F` (including post-train reruns).

## Cross-Phase Executive Summary
- **Overall verdict:** `NO-GO` for promotion in this cycle.
- **Observed pattern across phases:** local/protocol conformance improved, but deep-water runtime robustness remains unstable under chaos pressure.
- **Primary risk:** repeated `cpu_fault` + `panic_reset` loops in longrun conditions, despite better local guard scores.

## Phase-By-Phase Observations (A -> F)
- **Phase A (I/O hardening):** backpressure and truncation behavior improved, but recovery loops can still accumulate when entropy spikes.
- **Phase B (blindbox execution):** local-equivalent blindbox was useful for instrumentation; however, it is still weaker than true hostile-host/VPS friction.
- **Phase C (SFT/DPO rebalance):** dataset structure improved, but model behavior suggests partial optimization toward gate conformity.
- **Phase D (Wild OSS candidate gate):** candidate filtering improved stability of task setup, but did not resolve downstream longrun fragility.
- **Phase E (Wild OSS preflight gate):** preflight checks reduced setup failures; runtime robustness remains the bottleneck.
- **Phase F (baseline->training->post-train):** same-host comparison fairness improved; post-train longrun still regressed in deep-water chaos scenarios.

## Questions Requiring Architect Decisions

**1. Stage-Gate Strictness Across Full Cycle**
Given the A->F evidence, should `vliwEvidence` and `chaosEvidence` remain strict per-run gates?
- **Option A:** keep strict per-run hard gates.
- **Option B:** allow batch-level aggregate pass (for example, >=80% pass over fixed N runs).

**2. Panic-Loop Circuit Breaker Policy**
Should kernel policy enforce a hard-stop for repeated `panic_reset` loops?
- **Option A:** hard-stop (`SYS_EXIT` + forced callstack reset) after N resets in M ticks.
- **Option B:** retain current soft diagnostic behavior.

**3. Phase C Data Strategy Adjustment**
For next-cycle SFT/DPO, how aggressive should failure-recovery weighting be?
- **Option A:** increase trap-heavy rejected weighting and recovery-path positive weighting.
- **Option B:** keep current weighting and focus first on kernel-side mitigation.

**4. Phase B/Beyond Reality Gap**
Should local-equivalent blindbox evidence continue to count as gate evidence?
- **Option A:** count only as pre-gate signal; promotion requires real hostile-host/VPS evidence.
- **Option B:** continue counting local-equivalent as valid for gate decisions.

**5. Metric Hierarchy for Next Cycle**
Which metric should dominate pass/fail when objectives conflict?
- **Option A:** runtime resilience first (`MTTR`, panic-loop suppression), then schema conformance.
- **Option B:** schema/protocol conformance first, then runtime resilience.

**6. Same-Host Compare Interpretation (Phase F)**
Local guard improvement but longrun regression suggests mismatch between micro-eval and real runtime. How should we treat this?
- **Option A:** treat as overfitting warning; block promotion until longrun resilience improves.
- **Option B:** allow conditional promotion with rollback guardrails.

## My Current Doubts (From Phase A -> F)
1. We may still be over-optimizing to gate signatures instead of true recovery behavior under messy real-world logs.
2. Kernel safeguards are improved but may still be too permissive in high-entropy feedback loops.
3. Current pass criteria may blend two objectives (task progress and protocol purity) without an explicit hierarchy.

## Proposed Next Step (Pending Architect Answer)
1. Finalize gate strictness and metric hierarchy for next cycle.
2. Apply kernel-first panic-loop breaker if approved.
3. Re-run same-target longrun after policy/data changes to isolate true delta.

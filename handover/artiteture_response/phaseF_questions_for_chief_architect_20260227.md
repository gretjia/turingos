# Phase F: Architectural Decision Gates (2026-02-27)

## Executive Context
- **Cycle completion:** We completed the full loop (baseline -> data refresh -> same-host base vs finetuned compare -> post-train Wild OSS longrun -> final recursive audit).
- **Verdict:** NO-GO due to deep-water regression (high `cpu_fault` + `panic_reset`, failed VLIW/chaos sub-gates in post-train longrun).
- **Key observation:** The finetuned path improves local guard metrics but fails deep-water longrun gates, suggesting overfitting to gate syntax. The strongest remaining risk is runtime stability under chaos pressure, not schema-format compliance. Kernel backpressure behavior might still be too permissive under high-entropy outputs, amplifying trap loops. Same-host compare (Mac base vs finetuned) is now available, reducing previous fairness issues.

## Required Architect Decisions

**1. Stage-gate policy (`vliwEvidence` and `chaosEvidence`)**
Should these metrics remain hard per-run requirements, or can we accept an aggregate pass across a run batch?
- **Option A:** Keep as hard per-run requirements (100% pass rate per individual run).
- **Option B:** Accept aggregate pass across a run batch (for example, >80% pass rate across 5 runs).

**2. Kernel hard-stop policy**
Should we add a kernel hard-stop rule for repeated `panic_reset` loops?
- **Option A:** Yes, force `SYS_EXIT` and mandatory callstack reset after N resets in M ticks (for example, N=3, M=10).
- **Option B:** No, retain as a soft observability diagnostic.

**3. DPO weighting for trap-heavy samples**
How should `trap-heavy` samples (high `cpu_fault`/`panic_reset`) be handled in DPO weighting?
- **Option A:** Include as explicit rejected trajectories with stronger penalties (for example, w=-2.0).
- **Option B:** Include as standard rejected trajectories (baseline weighting).
- **Option C:** Exclude them entirely to avoid noise.

**4. `modelRepairAttempts` metric definition**
Is `modelRepairAttempts` an explicit gate metric or strictly diagnostic?
- **Option A:** Explicit gate metric (threshold: must be <= 3).
- **Option B:** Diagnostic metric only (no threshold enforced for pass/fail).

**5. MTTR target enforceability**
For the MTTR target, how strictly should `<8 ticks` be enforced?
- **Option A:** Enforce strictly measured only in Wild OSS longrun.
- **Option B:** Enforce in both Wild OSS longrun and local guard loops.
- **Option C:** Do not strictly enforce; use as diagnostic.

## Proposed Next-Cycle Action Plan (Pending Decision)
1. **Kernel-first hardening:** Enforce stronger I/O backpressure and panic-loop circuit breakers based on Decision 2.
2. **Data rebalance:** Prioritize failure-recovery trajectories from the latest post-train dirty traces (`audits/longrun/posttrain_mac_20260228/dirty_trace_20260228_015907.jsonl`).
3. **Delta isolation:** Re-run finetuned Wild OSS on the exact same target with the unchanged task to empirically isolate the delta.

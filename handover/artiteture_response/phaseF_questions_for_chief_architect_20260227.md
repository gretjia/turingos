# Phase F -> Questions for Chief Architect (2026-02-27)

## Context We Want to Confirm
- We completed full loop: baseline -> data refresh -> same-host base vs finetuned compare -> post-train Wild OSS longrun -> final recursive audit.
- Final recursive verdict is NO-GO due to deep-water regression (high `cpu_fault` + `panic_reset`, failed VLIW/chaos sub-gates in post-train longrun).

## My Communication to Architect
1. We did not stop at baseline; we executed the full cycle and kept all failure traces.
2. Same-host compare is now available (Mac base vs finetuned), fairness issue reduced.
3. The strongest remaining risk is not schema-format compliance; it is runtime stability under chaos pressure.
4. We need your decision on whether next cycle should prioritize kernel-side hardening first, or model-side SFT/DPO reweight first.

## Question List
1. For Stage-Gate policy, should `vliwEvidence` and `chaosEvidence` remain hard per-run requirements, or can we accept aggregate pass across a run batch?
2. Should we add a kernel hard-stop rule for repeated `panic_reset` (for example, N resets in M ticks => forced `SYS_EXIT` + mandatory callstack reset)?
3. Do you want `trap-heavy` samples (`cpu_fault/panic_reset`) to be weighted into DPO as explicit rejected trajectories with stronger penalties?
4. In your view, is `modelRepairAttempts` an explicit gate metric (threshold), or only a diagnostic metric?
5. For MTTR target, do you want strict `<8 ticks` measured only in Wild OSS longrun, or also in local guard loops?

## My Current Doubts
1. The finetuned path improves local guard metrics but still fails deep-water longrun gates; this suggests overfitting to gate syntax.
2. Kernel backpressure behavior might still be too permissive under high-entropy outputs, amplifying trap loops.
3. The current longrun success criteria may be mixing two objectives (task progress + protocol behavior) without a weighted hierarchy.

## Proposed Next-Cycle Focus (Pending Architect Approval)
1. Kernel-first hardening: enforce stronger I/O backpressure and panic-loop circuit breaker.
2. Data rebalance: prioritize failure-recovery trajectories from latest post-train dirty traces.
3. Re-run finetuned Wild OSS on same target with unchanged task to isolate delta.

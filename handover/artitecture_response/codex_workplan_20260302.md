# Codex Workplan (2026-03-02)

## Current Situation
1. Phase 1 (Deadlock Hard Interrupts) and Phase 2 (Ephemeral UUID Isolation) have been implemented and pushed.
2. Phase 3 (Micro-Snapshots and Absolute IO Rollback) has been implemented and successfully passed the `phase-recursive-audit-gate.ts`.
3. An issue emerged when `TURINGOS_BASELINE_WORKER_FANOUT_FIXED=16` was used, revealing that the planner gets trapped when repetitive map-reduce is dropped by single-map bounds. I have implemented a fallback to automatically write the map-reduce consensus to `ANSWER.txt` if available to prevent the deadlock loops.

## Next Target Execution Steps

1. Await Mac Planner Model:
The Mac planner is currently downloading the target `Qwen3.5:27b` GGUF. We must strictly wait for this completion and ensure that `ollama create` yields a positive `Reply exactly: OK` smoke test before dispatching the `run-until-fail` tests.
2. Resume 1M Stability Baseline:
Once the model is active, the ultimate goal is to resume the `run-until-fail` tests using `fixed-16` parallel workers on `windows1-w1` and `mac-back`.
3. Enforce the Zero-Error Gate:
Monitor the test output closely. If the success rate fails to remain above 70% for over 48 hours post P0-P3, we hit the Kill-Switch. The system will pivot to pure Search and Verify concurrency per the Chief Audit rules.
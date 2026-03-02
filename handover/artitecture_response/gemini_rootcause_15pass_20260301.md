# Gemini Root Cause Audit: Why Only 15 Consecutive Passes (2026-03-01)

## Input Evidence

- Report:
  - `benchmarks/audits/baseline/million_baseline_compare_20260301_160614.json`
- Failure artifact:
  - `benchmarks/audits/baseline/failure_artifacts/turingos_dualbrain_case_001116_20260301_160614.json`
- Key failure:
  - case `1116`, expected `2888`, answer file `3888`
  - repeated `PLANNER_MAP_REDUCE_DROPPED_AFTER_JOIN_KEEP_WORLD`
  - repeated `HYPERCORE_AUTOWRITE ... consensus=3888`

## Gemini Verdict (Condensed)

1. Primary failure is wrong worker consensus at case `1116`.
2. `singleMapPerProcess` prevents planner from issuing further corrective map-reduce attempts.
3. `autoWriteConsensusOnMapDrop` repeatedly writes wrong consensus and amplifies the stall.
4. System then burns ticks in repeated map-drop/autowrite loop until max tick limit.

## Codex Cross-Check

- Direct endpoint sanity test (`qwen2.5:7b`, `temperature=0`) on expression `1303+1585`:
  - Mac endpoint returned `2888` consistently.
  - Windows endpoint timed out in this spot test.
- Interpretation:
  - The `3888` failure is not proven to be a base-model deterministic arithmetic defect.
  - More likely a scheduler-context + noisy-worker-vote quality issue under fixed-fanout map-reduce.

## Immediate Fix Priority

1. Add arithmetic sanity gate before accepting/auto-writing consensus in baseline mode.
2. Prevent repeated autowrite loop when same consensus has already failed deterministic verifier.
3. Reduce invalid worker outputs (`WORKER_MAP_REDUCE_DROPPED` / timeout-heavy votes) before scaling fanout further.


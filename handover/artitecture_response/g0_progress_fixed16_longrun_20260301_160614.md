# G0 Progress Snapshot: Fixed-16 Longrun (2026-03-01 16:06 UTC)

## Scope

- Track latest `run-until-fail` status for the 1M baseline growth loop.
- Mode: `turingos_dualbrain`
- Topology: `omega-vm` controller, `Mac planner + Mac/Windows workers`

## Run Configuration

- `TURINGOS_BASELINE_WORKER_FANOUT_FIXED=16`
- `TURINGOS_BASELINE_WORKER_PARALLELISM=16`
- `TURINGOS_BASELINE_ORACLE_MAX_RETRIES=0`
- `TURINGOS_BASELINE_ORACLE_TIMEOUT_MS=10000`
- Planner lane:
  - `TURINGOS_BASELINE_PLANNER_MODEL=qwen3-coder:30b`
  - `TURINGOS_BASELINE_PLANNER_BASE_URL=http://100.72.87.94:11434/v1`
- Worker lanes:
  - `TURINGOS_BASELINE_WORKER_MODEL=qwen2.5:7b`
  - `TURINGOS_BASELINE_WORKER_BASE_URLS=http://100.72.87.94:11434/v1,http://100.123.90.25:11434/v1`

## Result Summary

- Report:
  - `benchmarks/audits/baseline/million_baseline_compare_20260301_160614.json`
- Result:
  - attempted: `16`
  - passed: `15`
  - failed: `1`
  - firstFailAt: `1116`
  - consecutivePassBeforeFirstFail: `15`
  - status: `FAIL`

## Failure Evidence

- First fail artifact:
  - `benchmarks/audits/baseline/failure_artifacts/turingos_dualbrain_case_001116_20260301_160614.json`
- Expected vs observed:
  - expected: `2888`
  - answer file: `3888`
- Journal indicators:
  - repeated `PLANNER_MAP_REDUCE_DROPPED_AFTER_JOIN_KEEP_WORLD`
  - repeated `HYPERCORE_AUTOWRITE ... consensus=3888`

## Diagnosis

- G0 contract hardening improved baseline survivability from immediate failures to `15` consecutive passes.
- Current primary bottleneck moved from format/contract crash to **wrong consensus acceptance** (semantic correctness issue).
- This is now a consensus-quality problem, not a schema-format problem.

## Next Action (Locked)

1. Add consensus sanity gate before planner auto-write is accepted:
   - if candidate consensus fails deterministic local arithmetic check, reject and force replanning.
2. Keep `run-until-fail -> debug -> resume` loop with cursor resume near fail point (`1116`).
3. Do not scale above fixed-16 before consensus-quality fix is validated.

## Ops Update (2026-03-01, Mac Planner Host)

- Objective: free disk, then upgrade planner-class model on Mac.
- Removed local models:
  - `qwq:32b`
  - `qwen2.5:0.5b-instruct`
- Upgraded Ollama:
  - from `0.17.0` to `0.17.4` (required to pull newer manifests).
- Installed new model:
  - `qwen3.5:27b` (`17 GB`).
- Then removed legacy planner model:
  - `qwen3-coder:30b`
- Current model inventory:
  - `qwen3.5:27b` (planner target)
  - `qwen2.5:7b` (worker target)
- Baseline code default switch completed:
  - openai planner default now `qwen3.5:27b` in `src/bench/million-baseline-compare.ts`.
- Smoke test:
  - `ollama run qwen3.5:27b "Reply exactly: OK"` returned `OK`.
- Current Mac data volume free space after install:
  - `/System/Volumes/Data` available `~56 GiB`.

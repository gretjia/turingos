# G0 Progress Snapshot: Fixed-16 Longrun (Qwen32B Planner) - 2026-03-02

## Scope
- Track the ultimate fallback run-until-fail status for the 1M baseline growth loop using `Qwen2.5-Coder-32B` as Planner due to architecture support limitations on macOS Ollama for `qwen35`.
- Mode: `turingos_dualbrain`
- Topology: `omega-vm` controller, `Mac planner + Mac/Windows workers`

## Run Configuration
- `TURINGOS_BASELINE_WORKER_FANOUT_FIXED=16`
- `TURINGOS_BASELINE_WORKER_PARALLELISM=16`
- Planner lane:
  - `TURINGOS_BASELINE_PLANNER_MODEL=qwen3-coder:30b` (alias pointing to `Qwen2.5-Coder-32B-Instruct-GGUF`)
  - `TURINGOS_BASELINE_PLANNER_BASE_URL=http://100.72.87.94:11434/v1`
- Worker lanes:
  - `TURINGOS_BASELINE_WORKER_MODEL=qwen2.5:7b`
  - `TURINGOS_BASELINE_WORKER_BASE_URLS=http://100.72.87.94:11434/v1,http://100.123.90.25:11434/v1`

## Current Action
The automated `run-until-fail` pipeline has successfully resumed from `case 1130` utilizing a headless tmux daemon to avoid historical SIGHUP crashes on SSH disconnects. The process is actively writing to `/home/zephryj/projects/turingos/benchmarks/audits/baseline/daemon_run.log`. It operates with continuous test incrementing, logging `failure_artifacts` robustly whenever verification drops below acceptable margins for the ensemble.
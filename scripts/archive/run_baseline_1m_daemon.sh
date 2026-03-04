#!/usr/bin/env bash
cd /home/zephryj/projects/turingos

export TURINGOS_BASELINE_PLANNER_ORACLE=openai
export TURINGOS_BASELINE_PLANNER_MODEL="qwen3-coder-30b.gguf"
export TURINGOS_BASELINE_PLANNER_BASE_URL="http://100.72.87.94:8080/v1"

# Single Node 32B configuration. By setting parallelism to 0, it behaves as a pure single-agent system.
export TURINGOS_BASELINE_WORKER_PARALLELISM=0

# Important hard constraint: no fallback guessing parsing
export TURINGOS_OPENAI_JSON_SCHEMA_ENABLED=1

echo "--- Starting Planner-Only execution ---" >> benchmarks/audits/baseline/daemon_run.log

nohup npx tsx src/bench/million-baseline-compare.ts \
  --modes qwen_direct \
  --start-test 1167 \
  --max-tests 1000000 \
  --stop-on-fail >> benchmarks/audits/baseline/daemon_run.log 2>&1 &

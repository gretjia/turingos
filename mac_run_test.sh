#!/usr/bin/env bash

# Use 127.0.0.1 for local Planner to avoid any Tailscale loopback latency entirely
export TURINGOS_BASELINE_PLANNER_ORACLE=openai
export TURINGOS_BASELINE_PLANNER_MODEL="qwen3-coder-30b.gguf"
export TURINGOS_BASELINE_PLANNER_BASE_URL="http://127.0.0.1:8080/v1"

export TURINGOS_BASELINE_WORKER_ORACLE=openai
export TURINGOS_BASELINE_WORKER_MODEL="qwen2.5:7b"
export TURINGOS_BASELINE_WORKER_BASE_URLS="http://127.0.0.1:11434/v1"

# Decreasing Worker Parallelism from 16 to 4 because the Mac (36GB Unified Memory) 
# is running both the 30B Planner and the 7B Workers. K=16 was causing severe SSD swap thrashing and Ollama timeouts.
export TURINGOS_BASELINE_WORKER_PARALLELISM=4
export TURINGOS_OPENAI_JSON_SCHEMA_ENABLED=1
export TURINGOS_HYPERCORE_AUTO_WRITE_CONSENSUS_ON_MAP_DROP=1

echo "Starting tests directly without daemon script. Outputting to daemon_run.log..."
npx tsx src/bench/million-baseline-compare.ts \
  --modes turingos_dualbrain \
  --start-test 1167 \
  --max-tests 1000000 \
  --continue-after-fail >> benchmarks/audits/baseline/daemon_run.log 2>&1

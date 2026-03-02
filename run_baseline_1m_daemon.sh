#!/usr/bin/env bash
cd /home/zephryj/projects/turingos

export TURINGOS_BASELINE_PLANNER_ORACLE=openai
export TURINGOS_BASELINE_PLANNER_MODEL="qwen3-coder:30b"
export TURINGOS_BASELINE_PLANNER_BASE_URL="http://100.72.87.94:8080/v1"

export TURINGOS_BASELINE_WORKER_ORACLE=openai
export TURINGOS_BASELINE_WORKER_MODEL="qwen2.5:7b"
export TURINGOS_BASELINE_WORKER_BASE_URLS="http://100.72.87.94:11434/v1,http://100.123.90.25:11434/v1"

export TURINGOS_BASELINE_WORKER_FANOUT_FIXED=16
export TURINGOS_BASELINE_WORKER_PARALLELISM=16

export TURINGOS_BASELINE_ORACLE_MAX_RETRIES=0
export TURINGOS_BASELINE_ORACLE_TIMEOUT_MS=30000

export TURINGOS_HYPERCORE_PLANNER_TEMPERATURE=0.2
export TURINGOS_HYPERCORE_WORKER_TEMPERATURE=0.0

export TURINGOS_BASELINE_PREFLIGHT_ENABLED=true
export TURINGOS_EPHEMERAL_WORKSPACE=1

export TURINGOS_OPENAI_JSON_SCHEMA_ENABLED=0
export TURINGOS_ORACLE_FRAME_MODE=stateless

LOG="/home/zephryj/projects/turingos/benchmarks/audits/baseline/daemon_run.log"

while true; do
  echo "--- Starting node process at $(date) ---" >> "$LOG"
  node node_modules/.bin/tsx src/bench/million-baseline-compare.ts --modes turingos_dualbrain --start-test 1159 --max-tests 1000000 --continue-after-fail >> "$LOG" 2>&1
  
  if [ $? -eq 0 ]; then
    echo "Process completed successfully." >> "$LOG"
    break
  fi
  
  echo "Process crashed or stopped with non-zero exit code. Retrying in 10 seconds..." >> "$LOG"
  sleep 10
done

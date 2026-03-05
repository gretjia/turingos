#!/usr/bin/env bash
cd /home/zephryj/projects/turingos
export TURINGOS_BASELINE_PLANNER_ORACLE=openai
export TURINGOS_BASELINE_PLANNER_MODEL="qwen3-coder-30b.gguf"
export TURINGOS_BASELINE_PLANNER_BASE_URL="http://100.72.87.94:8080/v1"
export TURINGOS_BASELINE_WORKER_ORACLE=openai
export TURINGOS_BASELINE_WORKER_MODEL="qwen2.5:7b"
export TURINGOS_BASELINE_WORKER_BASE_URLS="http://100.72.87.94:11434/v1"
export TURINGOS_BASELINE_WORKER_PARALLELISM=1
export TURINGOS_OPENAI_JSON_SCHEMA_ENABLED=1

node node_modules/.bin/tsx src/bench/million-baseline-compare.ts --modes turingos_dualbrain --start-test 1159 --max-tests 1159 > debug_test.log 2>&1

#!/bin/bash
export TURINGOS_BASELINE_WORKER_FANOUT_FIXED=4
export TURINGOS_BASELINE_WORKER_PARALLELISM=4
export TURINGOS_BASELINE_QWEN_MODEL="qwen3.5-27b-instruct-q4_k_m.gguf"
export TURINGOS_BASELINE_PLANNER_MODEL="qwen3.5-27b-instruct-q4_k_m.gguf"
export TURINGOS_BASELINE_WORKER_MODEL="Qwen3.5-9B-Q4_K_M.gguf"
export TURINGOS_BASELINE_PLANNER_BASE_URL="http://100.72.87.94:8080/v1"
export TURINGOS_BASELINE_WORKER_BASE_URL="http://100.72.87.94:8081/v1"
export TURINGOS_MAX_OUTPUT_TOKENS=4096
export TURINGOS_BASELINE_SKIP_DIRECT_KIMI=1
export TURINGOS_BASELINE_SKIP_DIRECT_QWEN=1
export TURINGOS_BASELINE_EPHEMERAL_WORKSPACE=0
export TURINGOS_OPENAI_JSON_SCHEMA_ENABLED=0
export TURINGOS_DEBUG_VERBOSE=1
export DEBUG=turingos*

cd /home/zephryj/projects/turingos
npx tsx src/bench/million-baseline-compare.ts --modes turingos_dualbrain --start-test 185 --max-tests 185 > run_debug_108.log 2>&1

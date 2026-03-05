#!/bin/bash
export TURINGOS_BASELINE_QWEN_MODEL="qwen3.5-27b-instruct-q4_k_m.gguf"
export TURINGOS_BASELINE_QWEN_BASE_URL="http://100.123.90.25:8080/v1"
export TURINGOS_MAX_OUTPUT_TOKENS=4096
export TURINGOS_BASELINE_TARGET_TESTS=1000000
export TURINGOS_DEBUG_VERBOSE=0
export TURINGOS_OPENAI_JSON_SCHEMA_ENABLED=1

cd /home/zephryj/projects/turingos

total_passed=0

for i in {1..3}; do
    echo "--- Starting Run $i ---"
    
    # We use a random start index to test different cases
    start_idx=$((1 + RANDOM % 10000))
    echo "Starting from case $start_idx"
    
    # Run the benchmark
    output=$(npx tsx src/bench/million-baseline-compare.ts --modes qwen_direct --start-test $start_idx --max-tests 10000 --stop-on-fail 2>&1)
    
    # Extract the report path from the last lines of output
    report_file=$(echo "$output" | grep -oP 'report=\K.*\.json' | tail -n 1)
    
    if [ -f "$report_file" ]; then
        passed=$(jq '.results[0].passed' "$report_file")
        echo "Run $i achieved $passed consecutive passes before failure."
        total_passed=$((total_passed + passed))
    else
        echo "Failed to find report file or script crashed!"
        echo "$output"
    fi
done

average=$(echo "scale=2; $total_passed / 3" | bc)
echo "======================================"
echo "Total Passed: $total_passed across 3 runs."
echo "Average Consecutive Passes: $average"
echo "======================================"

#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

BASE_URL="${BASE_URL:-http://localhost:11434/v1}"
MODEL="${MODEL:-qwen2.5:14b-instruct}"
LIMIT="${LIMIT:-200}"
SOURCE="${SOURCE:-local_alu}"
RUN_STAGED="${RUN_STAGED:-1}"

echo "[mac-local-alu] root=$ROOT_DIR"
echo "[mac-local-alu] base_url=$BASE_URL model=$MODEL limit=$LIMIT source=$SOURCE run_staged=$RUN_STAGED"

if ! curl -fsS --max-time 5 "$BASE_URL/models" >/dev/null; then
  echo "[mac-local-alu] ERROR: cannot reach $BASE_URL/models"
  echo "[mac-local-alu] Ensure Ollama is running and OpenAI-compatible API is enabled."
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "[mac-local-alu] node_modules missing, running npm install..."
  npm install
fi

echo "[mac-local-alu] Step A: build/refresh dataset"
npm run bench:ac41b-build-trace-dataset || true

DATASET="$(
  node -e "const fs=require('node:fs');const j=JSON.parse(fs.readFileSync('benchmarks/audits/local_alu/ac41b_dataset_latest.json','utf8'));process.stdout.write(j.output||'');"
)"

if [ -z "$DATASET" ] || [ ! -f "$DATASET" ]; then
  echo "[mac-local-alu] ERROR: dataset not found from benchmarks/audits/local_alu/ac41b_dataset_latest.json"
  exit 1
fi

echo "[mac-local-alu] Step B: local ALU eval dataset=$DATASET"
npm run bench:ac41b-local-alu-eval -- --dataset "$DATASET" --base-url "$BASE_URL" --model "$MODEL" --limit "$LIMIT"

LATEST_OUTPUT="$(ls -t benchmarks/audits/local_alu/ac41b_local_eval_outputs_*.jsonl | head -n1)"
if [ -z "$LATEST_OUTPUT" ] || [ ! -f "$LATEST_OUTPUT" ]; then
  echo "[mac-local-alu] ERROR: local eval output jsonl not found"
  exit 1
fi

echo "[mac-local-alu] Step C: gate AC4.1b input=$LATEST_OUTPUT"
npm run bench:ac41b-local-alu -- --input "$LATEST_OUTPUT" --source "$SOURCE"

if [ "$RUN_STAGED" = "1" ]; then
  echo "[mac-local-alu] Step D: staged acceptance + CI gates"
  npm run bench:staged-acceptance-recursive
  npm run bench:ci-gates
fi

echo "[mac-local-alu] Latest local_alu artifacts:"
ls -t benchmarks/audits/local_alu | head -n 10

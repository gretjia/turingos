# Worker Upgrade: Qwen 3.5 9B (2026-03-05)

## Overview
- **Action**: Upgraded the local TuringOS Worker model from Qwen 2.5 7B (via Ollama) to **Qwen 3.5 9B** (via `llama-server`).
- **Reason**: The 1M baseline test demonstrated that 7B-class models struggle heavily with strict JSON formatting schemas and zero-touch system constraints over prolonged periods. This resulted in frequent `repair parse failed` traps and MAP_REDUCE dropouts (most notably causing a halt at case 174).
- **Secondary Node Investigation**: Evaluated deploying a Windows node (AMD GPU) to expand worker concurrency. A baseline test of Qwen 3.5 27B on Windows yielded only ~2.6 consecutive passes without TuringOS protection. Decision was made to **prioritize node intelligence over node count** by keeping `worker_fanout=4` on the Mac but upgrading to the 9B model.

## Implementation Details
1. Downloaded `Qwen3.5-9B-Q4_K_M.gguf` via `hf-mirror.com`.
2. Killed the local Ollama daemon to free unified memory.
3. Spun up a secondary `llama-server` on port `8081` with `-np 4` for native 4-slot concurrency.
4. **Critical Fix**: Modified `million-baseline-compare.ts` to set `forceJsonSchema: false` for the worker endpoints. The `llama-server` OpenAI emulation layer occasionally throws HTTP 400 Bad Request or endless output loops when confronted with heavily nested JSON schema definitions from TuringOS. Disabling the strict schema enforcement immediately unblocked the 9B model, allowing it to output properly formatted frames.

## Results
- The system successfully resumed from case 174.
- The 9B model is performing one-shot parses perfectly and halting the planner gracefully.
- The path to the first 200 passes is stable.
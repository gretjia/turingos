# Phase0 Baseline Freeze (2026-02-27)

## Git Baseline

- HEAD: `0ff09438e0d7f61b7d197cf67b7351fe44d21a62`
- Branch: `main` (tracking `origin/main`)
- Working tree delta at freeze time:
  - `.git_diff_audit.txt` (untracked, pre-existing)
  - `handover/artitecture_response/dual_llm_bloody_delivery_action_plan_20260227.md` (new)

## Runtime Baseline (sanitized)

- `TURINGOS_ORACLE=openai`
- `TURINGOS_API_BASE_URL=https://api.groq.com/openai/v1`
- `TURINGOS_MODEL=llama-3.1-8b-instant`
- `TURINGOS_MAX_TICKS=200`
- `TURINGOS_MAX_OUTPUT_TOKENS=1024`
- `TURINGOS_TIMEOUT_MS=120000`

## Current Longrun/SFT Evidence Snapshot

- Latest longrun assets:
  - `benchmarks/audits/longrun/voyager_realworld_eval_latest.json`
  - `benchmarks/audits/longrun/trace.jsonl`
  - `benchmarks/audits/longrun/context_decay_profile.json`
  - `benchmarks/audits/longrun/thrashing.journal`
- Current gap snapshot:
  - `thrashing.journal` currently near-empty (header only).
  - `context_decay_profile.json` indicates trap events are insufficient for failure-recovery SFT.
  - No fresh raw death trace bundle with explicit panic-budget exhaustion chain.

## Phase0 Decision

- Freeze accepted.
- Proceed to Phase1 chaos sweep with explicit objective:
  - produce non-empty high-entropy trap/panic corpus
  - extract raw death traces
  - trigger Gemini recursive audit #1

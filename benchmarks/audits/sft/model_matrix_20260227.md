# SFT/API Model Matrix

- generated_at: 2026-02-27T11:29:44.341Z
- report_json: /home/zephryj/projects/turingos/benchmarks/audits/sft/model_matrix_20260227.json

| Name | Provider | Model | valid_json | schema_violation | mutex_violation | reflex_exact | deadlock_escape | avg_eval_ms | pass |
|---|---|---|---:|---:|---:|---:|---:|---:|---|
| api_groq_base | openai | llama-3.1-8b-instant | 1 | 0 | 0 | 1 | 1 | 219.50 | PASS |
| api_kimi | kimi | kimi-for-coding | 1 | 0 | 0 | 0 | 0 | 1320.50 | FAIL |
| local_qwen3_coder30b_mac | openai | qwen3-coder:30b | 1 | 0 | 0 | 1 | 1 | 433.08 | PASS |

## Notes
- This matrix is phase4-v1: includes API baseline and local base model. Fine-tuned local model row is pending.
- Schema violation uses explicit report field when available; falls back to (1 - valid_json_rate).


# SFT/API Model Matrix

- generated_at: 2026-02-27T17:51:49.763Z
- report_json: /home/zephryj/projects/turingos/benchmarks/audits/sft/model_matrix_20260227.json

| Name | Provider | Model | valid_json | schema_violation | mutex_violation | reflex_exact | deadlock_escape | avg_eval_ms | pass |
|---|---|---|---:|---:|---:|---:|---:|---:|---|
| api_groq_base | openai | llama-3.1-8b-instant | 1 | 0 | 0 | 1 | 1 | 219.50 | PASS |
| api_kimi | kimi | kimi-for-coding | 1 | 0 | 0 | 0 | 0 | 1320.50 | FAIL |
| local_qwen3_coder30b_mac | openai | qwen3-coder:30b | 1 | 0 | 0 | 1 | 1 | 433.08 | PASS |
| local_qwen3_finetuned_mac | openai | /Users/zephryj/work/turingos/models/qwen3-coder-30b-a3b-instruct-4bit | 1 | 0 | 0 | 1 | 1 | 954.62 | PASS |

## Notes
- Schema violation uses explicit report field when available; falls back to (1 - valid_json_rate).


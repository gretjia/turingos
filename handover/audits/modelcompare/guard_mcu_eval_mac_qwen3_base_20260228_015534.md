# Guard MCU Eval

- stamp: 20260228_015534
- mode: model
- pass: true
- report_json: /Users/zephryj/work/turingos/benchmarks/audits/sft/guard_mcu_eval_20260228_015534.json
- split_manifest: /Users/zephryj/work/turingos/benchmarks/data/sft/splits/latest_manifest.json
- policy_split: val
- reflex_split: val
- policy_file: /Users/zephryj/work/turingos/benchmarks/data/sft/splits/20260227_124652/policy/policy_val.jsonl
- reflex_file: /Users/zephryj/work/turingos/benchmarks/data/sft/splits/20260227_124652/reflex/reflex_val.jsonl
- threshold_profile: dev
- max_model_attempts: 2
- oracle_mode: openai
- base_url: http://127.0.0.1:11434/v1
- model: qwen3-coder:30b

## Metrics

- valid_json_rate: 1
- schema_violation_rate: 0
- mutex_violation_rate: 0
- reflex_exact_match_rate: 1
- deadlock_escape_rate: 1
- total_duration_ms: 41829
- avg_per_eval_ms: 995.93


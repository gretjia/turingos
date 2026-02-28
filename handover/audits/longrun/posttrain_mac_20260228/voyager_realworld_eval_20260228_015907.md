# Voyager Realworld Eval

- stamp: 20260228_015907
- workspace: /var/folders/w3/17p860vj3174xqzb2z010qth0000gn/T/turingos-voyager-realworld-hEwaty
- pass: false
- report_json: /Users/zephryj/work/turingos/benchmarks/audits/longrun/voyager_realworld_eval_20260228_015907.json
- trace_jsonl: /Users/zephryj/work/turingos/benchmarks/audits/longrun/voyager_realworld_trace_20260228_015907.jsonl
- trace_jsonl_latest: /Users/zephryj/work/turingos/benchmarks/audits/longrun/trace.jsonl
- dirty_trace_jsonl: /Users/zephryj/work/turingos/benchmarks/audits/longrun/dirty_trace_20260228_015907.jsonl
- dirty_trace_jsonl_latest: /Users/zephryj/work/turingos/benchmarks/audits/longrun/dirty_trace_latest.jsonl

## Runtime

- scenario_type: real_repo
- repo_url: https://github.com/keploy/keploy.git
- repo_ref: main
- repo_commit: 75bd8751fe162c3adf2b58af58b1bafa3213ce1d
- repo_dir: keploy
- repo_issue_url: https://github.com/keploy/keploy/issues/3843
- entry_pointer: VOYAGER_TASK.md
- oracle_mode: openai
- model: /Users/zephryj/work/turingos/models/qwen3-coder-30b-a3b-instruct-4bit
- base_url: http://127.0.0.1:8080/v1
- max_output_tokens: 1024
- max_retries: 1
- retry_base_delay_ms: 500
- retry_max_delay_ms: 2000
- request_timeout_ms: 15000

## Chaos Config

- exec_timeout_rate: 0.1
- write_deny_rate: 0.05
- log_flood_rate: 0.1
- log_flood_chars: 50000

## Metrics

- ticks_requested: 120
- ticks_observed: 67
- replay_tuples: 67
- context_min: 416
- context_max: 1838
- context_avg: 1009.39
- context_p95: 1767
- vliw_evidence: false (tick=n/a)
- chaos_paged_flood: false (tick=n/a)
- chaos_followup: (none)

## Checks

| Check | Result | Details |
|---|---|---|
| oracle_mode_is_real | PASS | mode=openai model=/Users/zephryj/work/turingos/models/qwen3-coder-30b-a3b-instruct-4bit |
| ticks_observed_>=_100 | FAIL | ticks=67 |
| vliw_combo_edit_push_then_exec | FAIL | missing tuple with [SYS_EDIT,SYS_PUSH] + SYS_EXEC |
| chaos_log_flood_detected_and_followed | FAIL | no paged command flood detected |
| context_o1_bound_under_4k_mmu | PASS | min=416 max=1838 avg=1009.39 p95=1767 |


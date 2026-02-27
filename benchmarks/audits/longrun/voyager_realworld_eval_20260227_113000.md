# Voyager Realworld Eval

- stamp: 20260227_113000
- workspace: /tmp/turingos-voyager-realworld-4G9iq7
- pass: false
- report_json: /home/zephryj/projects/turingos/benchmarks/audits/longrun/voyager_realworld_eval_20260227_113000.json
- trace_jsonl: /home/zephryj/projects/turingos/benchmarks/audits/longrun/voyager_realworld_trace_20260227_113000.jsonl
- trace_jsonl_latest: /home/zephryj/projects/turingos/benchmarks/audits/longrun/trace.jsonl
- dirty_trace_jsonl: /home/zephryj/projects/turingos/benchmarks/audits/longrun/dirty_trace_20260227_113000.jsonl
- dirty_trace_jsonl_latest: /home/zephryj/projects/turingos/benchmarks/audits/longrun/dirty_trace_latest.jsonl

## Runtime

- scenario_type: real_repo
- repo_url: https://github.com/sindresorhus/ky.git
- repo_ref: main
- repo_commit: 6f3d1bdb9ee928b88bb2901fd2e84c190542f583
- repo_dir: ky
- repo_issue_url: https://github.com/sindresorhus/ky/issues
- entry_pointer: VOYAGER_TASK.md
- oracle_mode: openai
- model: llama-3.1-8b-instant
- base_url: https://api.groq.com/openai/v1
- max_output_tokens: 512
- max_retries: 1
- retry_base_delay_ms: 300
- retry_max_delay_ms: 1200
- request_timeout_ms: 8000

## Chaos Config

- exec_timeout_rate: 0.7
- write_deny_rate: 0.5
- log_flood_rate: 0.8
- log_flood_chars: 70000

## Metrics

- ticks_requested: 12
- ticks_observed: 6
- replay_tuples: 6
- context_min: 745
- context_max: 1259
- context_avg: 896.83
- context_p95: 1259
- vliw_evidence: false (tick=n/a)
- chaos_paged_flood: false (tick=n/a)
- chaos_followup: (none)

## Checks

| Check | Result | Details |
|---|---|---|
| oracle_mode_is_real | PASS | mode=openai model=llama-3.1-8b-instant |
| ticks_observed_>=_100 | FAIL | ticks=6 |
| vliw_combo_edit_push_then_exec | FAIL | missing tuple with [SYS_EDIT,SYS_PUSH] + SYS_EXEC |
| chaos_log_flood_detected_and_followed | FAIL | no paged command flood detected |
| context_o1_bound_under_4k_mmu | PASS | min=745 max=1259 avg=896.83 p95=1259 |


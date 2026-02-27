# Voyager Realworld Eval

- stamp: 20260227_133652
- workspace: /tmp/turingos-voyager-realworld-Sl6IIC
- pass: false
- report_json: ../../../../benchmarks/audits/longrun/voyager_realworld_eval_20260227_133652.json
- trace_jsonl: ../../../../benchmarks/audits/longrun/voyager_realworld_trace_20260227_133652.jsonl
- trace_jsonl_latest: ../../../../benchmarks/audits/longrun/trace.jsonl
- dirty_trace_jsonl: ../../../../benchmarks/audits/longrun/dirty_trace_20260227_133652.jsonl
- dirty_trace_jsonl_latest: ../../../../benchmarks/audits/longrun/dirty_trace_latest.jsonl

## Runtime

- scenario_type: real_repo
- repo_url: https://github.com/sindresorhus/ky.git
- repo_ref: main
- repo_commit: 6f3d1bdb9ee928b88bb2901fd2e84c190542f583
- repo_dir: ky
- repo_issue_url: (not set)
- entry_pointer: VOYAGER_TASK.md
- oracle_mode: kimi
- model: kimi-for-coding
- base_url: https://api.kimi.com/coding
- max_output_tokens: 1024
- max_retries: 2
- retry_base_delay_ms: 500
- retry_max_delay_ms: 2000
- request_timeout_ms: 25000

## Chaos Config

- exec_timeout_rate: 0.1
- write_deny_rate: 0.05
- log_flood_rate: 0.1
- log_flood_chars: 50000

## Metrics

- ticks_requested: 130
- ticks_observed: 124
- replay_tuples: 124
- context_min: 730
- context_max: 3972
- context_avg: 1273.91
- context_p95: 3350
- vliw_evidence: true (tick=23)
- chaos_paged_flood: true (tick=10)
- chaos_followup: SYS_HALT

## Checks

| Check | Result | Details |
|---|---|---|
| oracle_mode_is_real | PASS | mode=kimi model=kimi-for-coding |
| ticks_observed_>=_100 | PASS | ticks=124 |
| vliw_combo_edit_push_then_exec | PASS | tick_seq=23 mind_ops=SYS_PUSH|SYS_PUSH|SYS_EDIT |
| chaos_log_flood_detected_and_followed | FAIL | flood_tick=10 followup=SYS_HALT |
| context_o1_bound_under_4k_mmu | PASS | min=730 max=3972 avg=1273.91 p95=3350 |


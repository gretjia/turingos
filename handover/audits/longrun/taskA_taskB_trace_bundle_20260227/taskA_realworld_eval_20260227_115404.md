# Voyager Realworld Eval

- stamp: 20260227_115404
- workspace: /tmp/turingos-voyager-realworld-7VpsDX
- pass: true
- report_json: ../../../../benchmarks/audits/longrun/voyager_realworld_eval_20260227_115404.json
- trace_jsonl: ../../../../benchmarks/audits/longrun/voyager_realworld_trace_20260227_115404.jsonl
- trace_jsonl_latest: ../../../../benchmarks/audits/longrun/trace.jsonl
- dirty_trace_jsonl: ../../../../benchmarks/audits/longrun/dirty_trace_20260227_115404.jsonl
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
- retry_base_delay_ms: 600
- retry_max_delay_ms: 2500
- request_timeout_ms: 25000

## Chaos Config

- exec_timeout_rate: 0.15
- write_deny_rate: 0.05
- log_flood_rate: 0.15
- log_flood_chars: 50000

## Metrics

- ticks_requested: 120
- ticks_observed: 100
- replay_tuples: 100
- context_min: 780
- context_max: 3972
- context_avg: 1272.26
- context_p95: 3900
- vliw_evidence: true (tick=17)
- chaos_paged_flood: true (tick=12)
- chaos_followup: SYS_EXEC

## Checks

| Check | Result | Details |
|---|---|---|
| oracle_mode_is_real | PASS | mode=kimi model=kimi-for-coding |
| ticks_observed_>=_100 | PASS | ticks=100 |
| vliw_combo_edit_push_then_exec | PASS | tick_seq=17 mind_ops=SYS_PUSH|SYS_EDIT |
| chaos_log_flood_detected_and_followed | PASS | flood_tick=12 followup=SYS_EXEC |
| context_o1_bound_under_4k_mmu | PASS | min=780 max=3972 avg=1272.26 p95=3900 |


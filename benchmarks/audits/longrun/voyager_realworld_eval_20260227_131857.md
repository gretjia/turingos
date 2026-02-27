# Voyager Realworld Eval

- stamp: 20260227_131857
- workspace: /tmp/turingos-voyager-realworld-Um5zbZ
- pass: true
- report_json: /home/zephryj/projects/turingos/benchmarks/audits/longrun/voyager_realworld_eval_20260227_131857.json
- trace_jsonl: /home/zephryj/projects/turingos/benchmarks/audits/longrun/voyager_realworld_trace_20260227_131857.jsonl
- trace_jsonl_latest: /home/zephryj/projects/turingos/benchmarks/audits/longrun/trace.jsonl
- dirty_trace_jsonl: /home/zephryj/projects/turingos/benchmarks/audits/longrun/dirty_trace_20260227_131857.jsonl
- dirty_trace_jsonl_latest: /home/zephryj/projects/turingos/benchmarks/audits/longrun/dirty_trace_latest.jsonl

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

- ticks_requested: 120
- ticks_observed: 116
- replay_tuples: 116
- context_min: 762
- context_max: 3974
- context_avg: 1273.65
- context_p95: 3241
- vliw_evidence: true (tick=8)
- chaos_paged_flood: true (tick=13)
- chaos_followup: SYS_EXEC

## Checks

| Check | Result | Details |
|---|---|---|
| oracle_mode_is_real | PASS | mode=kimi model=kimi-for-coding |
| ticks_observed_>=_100 | PASS | ticks=116 |
| vliw_combo_edit_push_then_exec | PASS | tick_seq=8 mind_ops=SYS_PUSH|SYS_EDIT |
| chaos_log_flood_detected_and_followed | PASS | flood_tick=13 followup=SYS_EXEC |
| context_o1_bound_under_4k_mmu | PASS | min=762 max=3974 avg=1273.65 p95=3241 |


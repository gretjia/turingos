# Voyager Realworld Eval

- stamp: 20260227_114406
- workspace: /tmp/turingos-voyager-realworld-48tbek
- pass: false
- report_json: /home/zephryj/projects/turingos/benchmarks/audits/longrun/voyager_realworld_eval_20260227_114406.json
- trace_jsonl: /home/zephryj/projects/turingos/benchmarks/audits/longrun/voyager_realworld_trace_20260227_114406.jsonl
- trace_jsonl_latest: /home/zephryj/projects/turingos/benchmarks/audits/longrun/trace.jsonl
- dirty_trace_jsonl: /home/zephryj/projects/turingos/benchmarks/audits/longrun/dirty_trace_20260227_114406.jsonl
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
- base_url: https://api.groq.com/openai/v1
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

- ticks_requested: 100
- ticks_observed: 0
- replay_tuples: 0
- context_min: 0
- context_max: 0
- context_avg: 0
- context_p95: 0
- vliw_evidence: false (tick=n/a)
- chaos_paged_flood: false (tick=n/a)
- chaos_followup: (none)

## Checks

| Check | Result | Details |
|---|---|---|
| oracle_mode_is_real | PASS | mode=kimi model=kimi-for-coding |
| ticks_observed_>=_100 | FAIL | ticks=0 |
| vliw_combo_edit_push_then_exec | FAIL | missing tuple with [SYS_EDIT,SYS_PUSH] + SYS_EXEC |
| chaos_log_flood_detected_and_followed | FAIL | no paged command flood detected |
| context_o1_bound_under_4k_mmu | PASS | min=0 max=0 avg=0 p95=0 |


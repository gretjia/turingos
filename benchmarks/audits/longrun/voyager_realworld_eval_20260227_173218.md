# Voyager Realworld Eval

- stamp: 20260227_173218
- workspace: /tmp/turingos-voyager-realworld-1G7Y9S
- pass: false
- report_json: /home/zephryj/projects/turingos/benchmarks/audits/longrun/voyager_realworld_eval_20260227_173218.json
- trace_jsonl: /home/zephryj/projects/turingos/benchmarks/audits/longrun/voyager_realworld_trace_20260227_173218.jsonl
- trace_jsonl_latest: /home/zephryj/projects/turingos/benchmarks/audits/longrun/trace.jsonl
- dirty_trace_jsonl: /home/zephryj/projects/turingos/benchmarks/audits/longrun/dirty_trace_20260227_173218.jsonl
- dirty_trace_jsonl_latest: /home/zephryj/projects/turingos/benchmarks/audits/longrun/dirty_trace_latest.jsonl

## Runtime

- scenario_type: real_repo
- repo_url: https://github.com/keploy/keploy.git
- repo_ref: main
- repo_commit: 75bd8751fe162c3adf2b58af58b1bafa3213ce1d
- repo_dir: keploy
- repo_issue_url: https://github.com/keploy/keploy/issues/3843
- entry_pointer: VOYAGER_TASK.md
- oracle_mode: kimi
- model: kimi-for-coding
- base_url: https://api.kimi.com/coding
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

- ticks_requested: 160
- ticks_observed: 69
- replay_tuples: 69
- context_min: 448
- context_max: 3996
- context_avg: 1803.94
- context_p95: 3992
- vliw_evidence: true (tick=7)
- chaos_paged_flood: true (tick=6)
- chaos_followup: SYS_EXEC

## Checks

| Check | Result | Details |
|---|---|---|
| oracle_mode_is_real | PASS | mode=kimi model=kimi-for-coding |
| ticks_observed_>=_100 | FAIL | ticks=69 |
| vliw_combo_edit_push_then_exec | PASS | tick_seq=7 mind_ops=SYS_PUSH|SYS_EDIT |
| chaos_log_flood_detected_and_followed | PASS | flood_tick=6 followup=SYS_EXEC |
| context_o1_bound_under_4k_mmu | PASS | min=448 max=3996 avg=1803.94 p95=3992 |


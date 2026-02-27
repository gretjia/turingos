# Voyager Realworld Eval

- stamp: 20260227_060719
- workspace: /tmp/turingos-voyager-realworld-jthTpH
- pass: false
- report_json: /home/zephryj/projects/turingos/benchmarks/audits/longrun/voyager_realworld_eval_20260227_060719.json

## Metrics

- ticks_requested: 120
- ticks_observed: 120
- replay_tuples: 120
- context_min: 848
- context_max: 4096
- context_avg: 3928.46
- context_p95: 4096
- vliw_evidence: false (tick=n/a)
- chaos_paged_flood: true (tick=3)
- chaos_followup: SYS_GOTO

## Checks

| Check | Result | Details |
|---|---|---|
| ticks_observed_>=_100 | PASS | ticks=120 |
| vliw_combo_edit_push_then_exec | FAIL | missing tuple with [SYS_EDIT,SYS_PUSH] + SYS_EXEC |
| chaos_log_flood_detected_and_followed | PASS | flood_tick=3 followup=SYS_GOTO |
| context_o1_bound_under_4k_mmu | PASS | min=848 max=4096 avg=3928.46 p95=4096 |


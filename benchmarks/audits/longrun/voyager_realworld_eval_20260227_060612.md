# Voyager Realworld Eval

- stamp: 20260227_060612
- workspace: /tmp/turingos-voyager-realworld-OKApWf
- pass: false
- report_json: /home/zephryj/projects/turingos/benchmarks/audits/longrun/voyager_realworld_eval_20260227_060612.json

## Metrics

- ticks_requested: 120
- ticks_observed: 32
- replay_tuples: 32
- context_min: 688
- context_max: 936
- context_avg: 826
- context_p95: 936
- vliw_evidence: false (tick=n/a)
- chaos_paged_flood: false (tick=n/a)
- chaos_followup: (none)

## Checks

| Check | Result | Details |
|---|---|---|
| ticks_observed_>=_100 | FAIL | ticks=32 |
| vliw_combo_edit_push_then_exec | FAIL | missing tuple with [SYS_EDIT,SYS_PUSH] + SYS_EXEC |
| chaos_log_flood_detected_and_followed | FAIL | no paged command flood detected |
| context_o1_bound_under_4k_mmu | PASS | min=688 max=936 avg=826 p95=936 |


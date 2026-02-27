# Chaos Monkey Gate

- stamp: 20260227_152955
- pass: true
- report_json: /home/zephryj/projects/turingos/benchmarks/audits/longrun/chaos_monkey_gate_20260227_152955.json

| Check | Result | Details |
|---|---|---|
| chaos_exec_timeout | PASS | timeout trap injected as expected |
| chaos_write_eacces | PASS | write blocked with EACCES and partial residue="w" |
| chaos_log_flood_paged | PASS | mode=paged token=6d17e570b42b7228 flood_chars=10000000 |
| halt_blocked_until_log_flood_followup | PASS | pointer=sys://trap/log_flood_followup_required?details=LOG_FLOOD%20follow-up%20required%20before%20proceeding. |
| log_flood_recovery_mttr_lte_5 | PASS | flood_idx=1 followup_idx=1 mttr_ticks=0 |
| tick_duration_under_30s | PASS | max_tick_ms=1993 |


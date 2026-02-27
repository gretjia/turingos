# Chaos Monkey Gate

- stamp: 20260227_152740
- pass: true
- report_json: /home/zephryj/projects/turingos/benchmarks/audits/longrun/chaos_monkey_gate_20260227_152740.json

| Check | Result | Details |
|---|---|---|
| chaos_exec_timeout | PASS | timeout trap injected as expected |
| chaos_write_eacces | PASS | write blocked with EACCES and partial residue="w" |
| chaos_log_flood_paged | PASS | mode=paged token=0b051bcc459b9bac flood_chars=10000000 |
| halt_blocked_until_log_flood_followup | PASS | pointer=sys://trap/log_flood_followup_required?details=LOG_FLOOD%20follow-up%20required%20before%20proceeding. |


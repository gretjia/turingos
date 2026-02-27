# Chaos Monkey Gate

- stamp: 20260227_061040
- pass: true
- report_json: /home/zephryj/projects/turingos/benchmarks/audits/longrun/chaos_monkey_gate_20260227_061040.json

| Check | Result | Details |
|---|---|---|
| chaos_exec_timeout | PASS | timeout trap injected as expected |
| chaos_write_eacces | PASS | write blocked with EACCES as expected |
| chaos_log_flood_paged | PASS | token=b137fc7ec7b6f327 |


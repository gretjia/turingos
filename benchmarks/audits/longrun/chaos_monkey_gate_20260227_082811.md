# Chaos Monkey Gate

- stamp: 20260227_082811
- pass: true
- report_json: /home/zephryj/projects/turingos/benchmarks/audits/longrun/chaos_monkey_gate_20260227_082811.json

| Check | Result | Details |
|---|---|---|
| chaos_exec_timeout | PASS | timeout trap injected as expected |
| chaos_write_eacces | PASS | write blocked with EACCES as expected |
| chaos_log_flood_paged | PASS | token=a830850adfbfb30e |


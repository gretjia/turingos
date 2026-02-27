# DevOps Blindbox VPS

- stamp: 20260227_154059
- host: linux1-lx
- workspace: (unknown)
- port: 0
- mttr_ops: 999
- ssh_exit_code: 1
- pass: false
- report_json: /home/zephryj/projects/turingos/benchmarks/audits/longrun/devops_blindbox_vps_20260227_154059.json

| Check | Result | Details |
|---|---|---|
| service_initial_health | FAIL | startup_failed pid=366285 port=18804 |
| service_down_after_kill | PASS | service down confirmed |
| service_recovered_after_restart | FAIL | restart failed pid=366318 |
| permission_denied_observed | PASS | append blocked by chmod 400 |
| permission_recovered | PASS | chmod+append recovered |
| ssh_exit_zero | FAIL | exit_code=1 |

## Note

- This benchmark runs on a real remote host over SSH (not local equivalent).

# DevOps Blindbox VPS

- stamp: 20260227_154405
- host: linux1-lx
- workspace: (unknown)
- port: 0
- mttr_ops: 999
- ssh_exit_code: 255
- pass: false
- report_json: /home/zephryj/projects/turingos/benchmarks/audits/longrun/devops_blindbox_vps_20260227_154405.json

| Check | Result | Details |
|---|---|---|
| service_initial_health | FAIL | startup_failed pid=366418 port=18706 log= |
| service_down_after_kill | PASS | service down confirmed |
| service_recovered_after_restart | PASS | recovered pid=366452 |
| permission_denied_observed | PASS | append blocked by chmod 400 |
| permission_recovered | PASS | chmod+append recovered |
| network_timeout_observed | PASS | blackhole probe failed as expected |
| ssh_exit_zero | FAIL | exit_code=255 |

## Note

- This benchmark runs on a real remote host over SSH (not local equivalent).

# DevOps Blindbox VPS

- stamp: 20260227_155930
- host: windows1-w1
- remote_shell: powershell
- workspace: C:\Users\jiazi\AppData\Local\Temp\turingos-devops-vps-0c777e44
- port: 18081
- mttr_ops: 1
- ssh_exit_code: 0
- pass: false
- report_json: /home/zephryj/projects/turingos/benchmarks/audits/longrun/devops_blindbox_vps_20260227_155930.json

| Check | Result | Details |
|---|---|---|
| service_initial_health | FAIL | startup_failed pid=18308 port=18081 log= |
| service_down_after_kill | PASS | service down confirmed |
| service_recovered_after_restart | PASS | recovered pid=14816 |
| permission_denied_observed | FAIL | append unexpectedly succeeded |
| permission_recovered | PASS | readonly cleared + append recovered |
| network_timeout_observed | PASS | blackhole probe failed as expected |
| network_fallback_recovered | PASS | local fallback healthy |
| mttr_under_8_ops | PASS | mttr_ops=1 |
| ssh_exit_zero | PASS | exit_code=0 |

## Note

- This benchmark runs on a real remote host over SSH (not local equivalent).

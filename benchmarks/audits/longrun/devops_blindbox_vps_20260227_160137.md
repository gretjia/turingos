# DevOps Blindbox VPS

- stamp: 20260227_160137
- host: windows1-w1
- remote_shell: powershell
- workspace: C:\Users\jiazi\AppData\Local\Temp\turingos-devops-vps-eb11c172
- port: 18307
- mttr_ops: 1
- ssh_exit_code: 0
- pass: false
- report_json: /home/zephryj/projects/turingos/benchmarks/audits/longrun/devops_blindbox_vps_20260227_160137.json

| Check | Result | Details |
|---|---|---|
| python_runtime_present | PASS | python=C:\Python314\python.exe |
| service_initial_health | PASS | startup_ok pid=16564 port=18307 |
| service_down_after_kill | FAIL | service still alive after kill |
| service_recovered_after_restart | PASS | recovered pid=3616 |
| permission_denied_observed | PASS | append blocked deny_applied=True |
| permission_recovered | PASS | readonly cleared + append recovered |
| network_timeout_observed | PASS | blackhole probe failed as expected |
| network_fallback_recovered | PASS | local fallback healthy |
| mttr_under_8_ops | PASS | mttr_ops=1 |
| ssh_exit_zero | PASS | exit_code=0 |

## Note

- This benchmark runs on a real remote host over SSH (not local equivalent).

# DevOps Blindbox VPS

- stamp: 20260227_160502
- host: windows1-w1
- remote_shell: powershell
- workspace: C:\Users\jiazi\AppData\Local\Temp\turingos-devops-vps-1c56ca69
- port: 18404
- mttr_ops: 1
- ssh_exit_code: 0
- pass: false
- report_json: /home/zephryj/projects/turingos/benchmarks/audits/longrun/devops_blindbox_vps_20260227_160502.json

| Check | Result | Details |
|---|---|---|
| python_runtime_present | PASS | python=C:\Python314\python.exe |
| service_initial_health | PASS | startup_ok pid=7960 port=18404 |
| service_down_after_kill | FAIL | listener_before=7960 listener_after=0 port_down=True |
| service_recovered_after_restart | PASS | recovered pid=15652 |
| permission_denied_observed | PASS | append blocked deny_applied=True |
| permission_recovered | PASS | readonly cleared + append recovered |
| network_timeout_observed | PASS | blackhole probe failed as expected |
| network_fallback_recovered | PASS | local fallback healthy |
| mttr_under_8_ops | PASS | mttr_ops=1 |
| ssh_exit_zero | PASS | exit_code=0 |

## Note

- This benchmark runs on a real remote host over SSH (not local equivalent).

# DevOps Blindbox VPS

- stamp: 20260227_160408
- host: windows1-w1
- remote_shell: powershell
- workspace: C:\Users\jiazi\AppData\Local\Temp\turingos-devops-vps-eaccc3fc
- port: 18810
- mttr_ops: 1
- ssh_exit_code: 0
- pass: false
- report_json: /home/zephryj/projects/turingos/benchmarks/audits/longrun/devops_blindbox_vps_20260227_160408.json

| Check | Result | Details |
|---|---|---|
| python_runtime_present | PASS | python=C:\Python314\python.exe |
| service_initial_health | PASS | startup_ok pid=11816 port=18810 |
| service_down_after_kill | FAIL | listener_before=11816 listener_after=11816 port_down=False |
| service_recovered_after_restart | PASS | recovered pid=18120 |
| permission_denied_observed | PASS | append blocked deny_applied=True |
| permission_recovered | PASS | readonly cleared + append recovered |
| network_timeout_observed | PASS | blackhole probe failed as expected |
| network_fallback_recovered | PASS | local fallback healthy |
| mttr_under_8_ops | PASS | mttr_ops=1 |
| ssh_exit_zero | PASS | exit_code=0 |

## Note

- This benchmark runs on a real remote host over SSH (not local equivalent).

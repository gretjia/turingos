# DevOps Blindbox VPS

- stamp: 20260227_160556
- host: windows1-w1
- remote_shell: powershell
- workspace: C:\Users\jiazi\AppData\Local\Temp\turingos-devops-vps-4cc2fb36
- port: 18804
- mttr_ops: 1
- ssh_exit_code: 0
- pass: true
- report_json: /home/zephryj/projects/turingos/benchmarks/audits/longrun/devops_blindbox_vps_20260227_160556.json

| Check | Result | Details |
|---|---|---|
| python_runtime_present | PASS | python=C:\Python314\python.exe |
| service_initial_health | PASS | startup_ok pid=22028 port=18804 |
| service_down_after_kill | PASS | listener_before=22028 listener_after=0 port_down=True |
| service_recovered_after_restart | PASS | recovered pid=21900 |
| permission_denied_observed | PASS | append blocked deny_applied=True |
| permission_recovered | PASS | readonly cleared + append recovered |
| network_timeout_observed | PASS | blackhole probe failed as expected |
| network_fallback_recovered | PASS | local fallback healthy |
| mttr_under_8_ops | PASS | mttr_ops=1 |
| ssh_exit_zero | PASS | exit_code=0 |

## Note

- This benchmark runs on a real remote host over SSH (not local equivalent).

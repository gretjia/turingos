# DevOps Blindbox Local

- stamp: 20260227_113425
- workspace: /tmp/turingos-devops-local-MdUEyU
- journal: /tmp/turingos-devops-local-MdUEyU/.journal.log
- pass: false

| Check | Result | Details |
|---|---|---|
| service_initial_health | FAIL | curl_exit=7 |
| service_down_after_kill | PASS | curl_exit=7 |
| service_recovered_after_restart | FAIL | curl_exit=7 |
| permission_denied_observed | PASS | append_exit=1 |
| permission_recovered | PASS | fix_exit=0 |
| network_timeout_observed | PASS | blackhole_exit=28 |
| network_fallback_recovered | PASS | fallback_exit=0 |

## Note

- This is local equivalent of DevOps blindbox due missing Docker/VPS orchestration in current VM.

# DevOps Blindbox Local

- stamp: 20260227_113450
- workspace: /tmp/turingos-devops-local-3hMJcv
- journal: /tmp/turingos-devops-local-3hMJcv/.journal.log
- pass: false

| Check | Result | Details |
|---|---|---|
| service_initial_health | PASS | startup_ok=true curl_exit=0 |
| service_down_after_kill | FAIL | curl_exit=0 |
| service_recovered_after_restart | PASS | recovered_ok=true curl_exit=0 |
| permission_denied_observed | PASS | append_exit=1 |
| permission_recovered | PASS | fix_exit=0 |
| network_timeout_observed | PASS | blackhole_exit=28 |
| network_fallback_recovered | PASS | fallback_exit=0 |

## Note

- This is local equivalent of DevOps blindbox due missing Docker/VPS orchestration in current VM.

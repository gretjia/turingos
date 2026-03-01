# Phase B Report: Real VPS Blindbox on windows1-w1 (2026-02-27)

## Scope
- Objective: Execute Phase B on a real remote host (non-local-equivalent) and validate short-term gate from architect response.
- Host policy: Explicit owner approval enforced by runtime guard.
- Approved host used: `windows1-w1` (user-confirmed `windows1`).

## Code Changes
- Updated [`src/bench/devops-blindbox-vps.ts`](/home/zephryj/projects/turingos/src/bench/devops-blindbox-vps.ts):
  - Added mandatory hardware approval gate:
    - `TURINGOS_VPS_HOST` required
    - `TURINGOS_APPROVED_HOSTS` required and whitelist-checked
  - Added remote shell support:
    - `bash` (Linux)
    - `powershell` (Windows)
  - Added Windows blindbox fault-injection path and parser-compatible `CHECK|...` / `META|...` emission.
  - Hardened Windows process kill and probe logic:
    - Listener PID discovery
    - kill-tree + down verification
  - Hardened permission fault injection on Windows with read-only + strict append failure capture.

## Execution Command
```bash
TURINGOS_VPS_HOST=windows1-w1 \
TURINGOS_APPROVED_HOSTS=windows1-w1 \
TURINGOS_VPS_REMOTE_SHELL=powershell \
npm run -s bench:devops-blindbox-vps
```

## Result
- Gate: `PASS`
- Latest evidence:
  - [`benchmarks/audits/longrun/devops_blindbox_vps_20260227_160556.json`](/home/zephryj/projects/turingos/benchmarks/audits/longrun/devops_blindbox_vps_20260227_160556.json)
  - [`benchmarks/audits/longrun/devops_blindbox_vps_20260227_160556.md`](/home/zephryj/projects/turingos/benchmarks/audits/longrun/devops_blindbox_vps_20260227_160556.md)

Key checks:
- `python_runtime_present`: PASS
- `service_initial_health`: PASS
- `service_down_after_kill`: PASS
- `service_recovered_after_restart`: PASS
- `permission_denied_observed`: PASS
- `permission_recovered`: PASS
- `network_timeout_observed`: PASS
- `network_fallback_recovered`: PASS
- `mttr_under_8_ops`: PASS (`mttr_ops=1`)
- `ssh_exit_zero`: PASS

## Handover Evidence Bundle
- [`handover/audits/longrun/phaseB_vps_blindbox_20260227/manifest.json`](/home/zephryj/projects/turingos/handover/audits/longrun/phaseB_vps_blindbox_20260227/manifest.json)
- [`handover/audits/longrun/phaseB_vps_blindbox_20260227/devops_blindbox_vps_20260227_160556.json`](/home/zephryj/projects/turingos/handover/audits/longrun/phaseB_vps_blindbox_20260227/devops_blindbox_vps_20260227_160556.json)
- [`handover/audits/longrun/phaseB_vps_blindbox_20260227/devops_blindbox_vps_20260227_160556.md`](/home/zephryj/projects/turingos/handover/audits/longrun/phaseB_vps_blindbox_20260227/devops_blindbox_vps_20260227_160556.md)

## Raw Death Traces (Intermediate Failures)
- [`benchmarks/audits/longrun/devops_blindbox_vps_20260227_155854.json`](/home/zephryj/projects/turingos/benchmarks/audits/longrun/devops_blindbox_vps_20260227_155854.json): PowerShell encoded-command length path failed (no `CHECK` rows).
- [`benchmarks/audits/longrun/devops_blindbox_vps_20260227_155930.json`](/home/zephryj/projects/turingos/benchmarks/audits/longrun/devops_blindbox_vps_20260227_155930.json): service startup + permission deny instability.
- [`benchmarks/audits/longrun/devops_blindbox_vps_20260227_160035.json`](/home/zephryj/projects/turingos/benchmarks/audits/longrun/devops_blindbox_vps_20260227_160035.json): fixed startup/permission, kill-check still unstable.
- [`benchmarks/audits/longrun/devops_blindbox_vps_20260227_160137.json`](/home/zephryj/projects/turingos/benchmarks/audits/longrun/devops_blindbox_vps_20260227_160137.json): residual kill validation issue.
- [`benchmarks/audits/longrun/devops_blindbox_vps_20260227_160229.json`](/home/zephryj/projects/turingos/benchmarks/audits/longrun/devops_blindbox_vps_20260227_160229.json): listener kill false-negative persisted.
- [`benchmarks/audits/longrun/devops_blindbox_vps_20260227_160408.json`](/home/zephryj/projects/turingos/benchmarks/audits/longrun/devops_blindbox_vps_20260227_160408.json): listener-after edge case (`pid=0`) before final gate correction.
- [`benchmarks/audits/longrun/devops_blindbox_vps_20260227_160502.json`](/home/zephryj/projects/turingos/benchmarks/audits/longrun/devops_blindbox_vps_20260227_160502.json): near-pass run preceding final pass.

## Audit Status
- Gemini recursive audit completed:
  - [`handover/artiteture_response/gemini_recursive_audit_phaseB_20260227.md`](/home/zephryj/projects/turingos/handover/artiteture_response/gemini_recursive_audit_phaseB_20260227.md)
  - Verdict: `PASS` (confidence `98/100`)

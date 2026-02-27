# Handover Index (AI-Agent Friendly)

This directory is the review entrypoint for the current audit cycle.

## Read Order
1. `artiteture_response/chief_architect_independent_audit_reply_20260227.md`
2. `artiteture_response/final_complete_action_plan_20260227.md`
3. `artiteture_response/phaseA_io_hardening_report_20260227.md`
4. `artiteture_response/gemini_recursive_audit_phaseA_20260227.md`
5. `artiteture_response/phaseB_vps_blindbox_report_20260227.md`
6. `artiteture_response/gemini_recursive_audit_phaseB_20260227.md`
7. `artiteture_response/phaseC_sft_dpo_rebalance_report_20260227.md`
8. `audits/README.md`

## Directory Map
- `artiteture_response/`
  - Human-readable phase reports and recursive-audit conclusions for this submission.
- `audits/`
  - Active evidence bundle used for current review (death traces, task A/B bundle, local model eval).
- `archive/20260227_audit_trim/`
  - Prior-cycle or non-essential audit files moved out of active review path.

## Current Submission Evidence
- Raw death traces manifest:
  - `audits/longrun/raw_death_traces_20260227/manifest.json`
- Task A/B bundle manifest:
  - `audits/longrun/taskA_taskB_trace_bundle_20260227/manifest.json`
- Local model guard eval summary:
  - `audits/localmodel/guard_mcu_eval_latest.md`
- Phase B (approved real VPS on windows1-w1):
  - `audits/longrun/phaseB_vps_blindbox_20260227/manifest.json`
- Phase C (SFT/DPO rebalance):
  - `audits/sft/phaseC_sft_dpo_20260227/manifest.json`

## Compatibility Notes
- If an agent expects a singular `audit/` entry, use:
  - `audit/README.md` (alias that points to `audits/README.md`)
- Legacy “recursive/protocol/longrun latest” gate docs were archived under:
  - `archive/20260227_audit_trim/audits/`

# Handover Index (AI-Agent Friendly)

This directory is the review entrypoint for the current audit cycle.

## Read Order
1. `artitecture_response/dual_llm_bloody_delivery_action_plan_20260227.md`
2. `artitecture_response/phase1_chaos_sweep_report_20260227.md`
3. `artitecture_response/phase2_realworld_ab_report_20260227.md`
4. `artitecture_response/phase3_sft_dpo_dataset_report_20260227.md`
5. `artitecture_response/phase4_model_matrix_report_20260227.md`
6. `artitecture_response/phase5_context_degradation_report_20260227.md`
7. `artitecture_response/gemini_recursive_audit_phase5_20260227.md`
8. `audits/README.md`

## Directory Map
- `artitecture_response/`
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

## Compatibility Notes
- If an agent expects a singular `audit/` entry, use:
  - `audit/README.md` (alias that points to `audits/README.md`)
- Legacy “recursive/protocol/longrun latest” gate docs were archived under:
  - `archive/20260227_audit_trim/audits/`

# Handover Index (AI-Agent Friendly)

This directory keeps only the active reports/audits generated after the latest architect reply.
Older materials are moved to `archive/`.

## Read Order
1. `artiteture_response/chief_architect_independent_audit_reply_20260227.md`
2. `artiteture_response/phaseF_full_cycle_supervision_plan_20260227.md`
3. `artiteture_response/phaseF_baseline_to_trainingprep_report_20260227.md`
4. `artiteture_response/phaseF_samehost_mac_base_vs_finetuned_compare_20260227.md`
5. `artiteture_response/phaseF_posttrain_wildoss_longrun_report_20260227.md`
6. `artiteture_response/gemini_recursive_audit_phaseF_final_20260227.md`
7. `artiteture_response/phaseF_final_no_go_report_20260227.md`
8. `artiteture_response/phaseF_questions_for_chief_architect_20260227.md`
9. `audits/README.md`

## Directory Map
- `artiteture_response/`
  - Active phase reports, recursive audits, and architect Q&A notes.
- `audits/`
  - Active evidence bundles for current cycle (longrun, model compare, SFT, local model eval).
- `archive/20260227_audit_trim/`
  - Previously archived older-cycle handover materials.
- `archive/20260228_post_latest_architect_trim/`
  - Legacy folder naming (`archive/20260228_post_latest_architect_trim/artitecture_response/`) and other pre-current-layout remnants.

## Current Submission Evidence
- Longrun raw death traces:
  - `audits/longrun/raw_death_traces_20260227/manifest.json`
- Longrun post-train Wild OSS run (Mac, finetuned runtime profile):
  - `audits/longrun/posttrain_mac_20260228/voyager_realworld_eval_20260228_015907.json`
- Same-host base vs finetuned guard compare inputs:
  - `audits/modelcompare/guard_mcu_eval_mac_qwen3_base_20260228_015534.json`
  - `audits/localmodel/guard_mcu_eval_mac_qwen3_finetuned_latest.json`
- SFT/DPO phase bundle:
  - `audits/sft/phaseC_sft_dpo_20260227/manifest.json`

## Compatibility Notes
- Alias entry for tools expecting singular path:
  - `audit/README.md` -> `audits/README.md`

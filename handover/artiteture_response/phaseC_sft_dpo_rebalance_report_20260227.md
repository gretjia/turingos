# Phase C Report: SFT/DPO Rebalance (2026-02-27)

## Scope
- Objective: Execute Phase C data pipeline and align training recipe to architect constraint.
- Constraint baseline: failure-recovery dominant recipe with explicit DPO chosen/rejected contrasts.

## Code Changes
- Updated [`src/bench/failure-recovery-dataset-stats.ts`](/home/zephryj/projects/turingos/src/bench/failure-recovery-dataset-stats.ts):
  - Replaced fixed 40/40/20 with configurable ratio envs.
  - Default target now aligns to `15/65/20`:
    - `TURINGOS_SFT_RATIO_GOLDEN=0.15`
    - `TURINGOS_SFT_RATIO_FAILURE=0.65`
    - `TURINGOS_SFT_RATIO_REJECTED=0.20`
- Added [`src/bench/sft-dpo-grit-recipe.ts`](/home/zephryj/projects/turingos/src/bench/sft-dpo-grit-recipe.ts):
  - Builds phase-level SFT/DPO recipe artifact.
  - Produces chosen/rejected DPO pairs from real trap-context traces.
- Updated [`package.json`](/home/zephryj/projects/turingos/package.json):
  - Added `bench:sft-dpo-grit-recipe`.

## Execution
```bash
npm run -s bench:guard-sft-dataset
npm run -s bench:failure-recovery-dataset-stats
npm run -s bench:guard-sft-split
npm run -s bench:sft-dpo-grit-recipe
npm run -s bench:model-matrix-report
```

## Results
- `guard-sft-dataset`: PASS (`policy_rows=615`, `reflex_rows=51`)
- `failure-recovery-dataset-stats`: PASS with target ratio `15/65/20`
  - available: `golden=509`, `failure_recovery=292`, `rejected=24`
  - proposed sample: `total=120`, `18/78/24`
- `guard-sft-split`: PASS (`policy train/val/test = 492/61/62`, `reflex = 40/5/6`)
- `sft-dpo-grit-recipe`: PASS (`selected=120`, `dpo_pairs=24`)
- `model-matrix-report`: PASS (`rows=4`; Base/API/Fine-tuned matrix present)

## Evidence
- Dataset summary: [`benchmarks/audits/sft/guard_sft_dataset_latest.json`](/home/zephryj/projects/turingos/benchmarks/audits/sft/guard_sft_dataset_latest.json)
- Ratio stats: [`benchmarks/audits/sft/failure_recovery_dataset_stats_latest.json`](/home/zephryj/projects/turingos/benchmarks/audits/sft/failure_recovery_dataset_stats_latest.json)
- Split summary: [`benchmarks/audits/sft/guard_sft_split_latest.json`](/home/zephryj/projects/turingos/benchmarks/audits/sft/guard_sft_split_latest.json)
- Grit recipe: [`handover/sft_dpo_grit_recipe_dataset.json`](/home/zephryj/projects/turingos/handover/sft_dpo_grit_recipe_dataset.json)
- Matrix: [`benchmarks/audits/sft/model_matrix_latest.json`](/home/zephryj/projects/turingos/benchmarks/audits/sft/model_matrix_latest.json)

## Handover Bundle
- [`handover/audits/sft/phaseC_sft_dpo_20260227/manifest.json`](/home/zephryj/projects/turingos/handover/audits/sft/phaseC_sft_dpo_20260227/manifest.json)
- [`handover/audits/sft/phaseC_sft_dpo_20260227/failure_recovery_dataset_stats_latest.json`](/home/zephryj/projects/turingos/handover/audits/sft/phaseC_sft_dpo_20260227/failure_recovery_dataset_stats_latest.json)
- [`handover/audits/sft/phaseC_sft_dpo_20260227/sft_dpo_grit_recipe_dataset.json`](/home/zephryj/projects/turingos/handover/audits/sft/phaseC_sft_dpo_20260227/sft_dpo_grit_recipe_dataset.json)
- [`handover/audits/sft/phaseC_sft_dpo_20260227/model_matrix_latest.json`](/home/zephryj/projects/turingos/handover/audits/sft/phaseC_sft_dpo_20260227/model_matrix_latest.json)

## Audit Status
- Gemini recursive audit completed:
  - [`handover/artiteture_response/gemini_recursive_audit_phaseC_20260227.md`](/home/zephryj/projects/turingos/handover/artiteture_response/gemini_recursive_audit_phaseC_20260227.md)
  - Verdict: `PASS` (confidence `100/100`)

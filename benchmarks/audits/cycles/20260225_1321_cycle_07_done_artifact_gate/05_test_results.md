# Test Results

- api_health_at_start: NORMAL
- runStamp: 20260225-132128
- passed: 0/3
- completion_avg: 0
- plan_avg: 0.7381
- drift_avg: 0
- traps_avg: WATCHDOG=0, CPU=0, IO=5.3333, PAGE=5.3333

## pipeline_ordered_execution
- pass: false
- completion: 0
- plan: 0.7143
- finalD: sys://append/plan/progress.log
- missing_or_wrong_files: artifacts/input.csv, artifacts/high.csv, artifacts/sum.txt, artifacts/manifest.txt, result/RESULT.json

## fault_recovery_resume
- pass: false
- completion: 0
- plan: 1
- finalD: HALT
- missing_or_wrong_files: inputs/source.txt, outputs/colors_upper.txt, outputs/count.txt, result/RESULT.json

## long_checklist_stability
- pass: false
- completion: 0
- plan: 0.5
- finalD: milestones/m06.txt
- missing_or_wrong_files: milestones/m01.txt, milestones/m02.txt, milestones/m03.txt, milestones/m04.txt, milestones/m05.txt, milestones/m06.txt, milestones/m07.txt, milestones/m08.txt, milestones/sequence.txt, result/RESULT.json

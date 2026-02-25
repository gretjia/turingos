# Test Results

- api_health_at_start: NORMAL
- runStamp: 20260225-132923
- passed: 0/3
- completion_avg: 0
- plan_avg: 0.1706
- drift_avg: 0
- traps_avg: WATCHDOG=0, CPU=0, IO=5.6667, PAGE=5.3333

## pipeline_ordered_execution
- pass: false
- completion: 0
- plan: 0.1429
- finalD: artifacts/input.csv
- failed_files: artifacts/input.csv(text mismatch), artifacts/high.csv(missing file), artifacts/sum.txt(missing file), artifacts/manifest.txt(missing file), result/RESULT.json(missing file)

## fault_recovery_resume
- pass: false
- completion: 0
- plan: 0.2857
- finalD: sys://append/plan/progress.log
- failed_files: inputs/source.txt(text mismatch), outputs/colors_upper.txt(missing file), outputs/count.txt(missing file), result/RESULT.json(missing file)

## long_checklist_stability
- pass: false
- completion: 0
- plan: 0.0833
- finalD: sys://append/plan/progress.log
- failed_files: milestones/m01.txt(text mismatch), milestones/m02.txt(missing file), milestones/m03.txt(missing file), milestones/m04.txt(missing file), milestones/m05.txt(missing file), milestones/m06.txt(missing file), milestones/m07.txt(missing file), milestones/m08.txt(missing file), milestones/sequence.txt(missing file), result/RESULT.json(missing file)

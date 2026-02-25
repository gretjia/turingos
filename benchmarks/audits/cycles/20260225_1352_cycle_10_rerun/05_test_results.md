# Test Results

- api_health_at_start: NORMAL
- runStamp: 20260225-135210
- passed: 0/3
- completion_avg: 0.0833
- plan_avg: 0.377
- drift_avg: 0
- traps_avg: WATCHDOG=0, CPU=0.3333, IO=3.6667, PAGE=3.6667

## pipeline_ordered_execution
- pass: false
- completion: 0
- plan: 0.2857
- finalD: sys://append/plan/progress.log
- failed_files: artifacts/input.csv(text mismatch), artifacts/high.csv(missing file), artifacts/sum.txt(missing file), artifacts/manifest.txt(missing file), result/RESULT.json(missing file)

## fault_recovery_resume
- pass: false
- completion: 0.25
- plan: 0.4286
- finalD: sys://append/plan/progress.log
- failed_files: inputs/source.txt(text mismatch), outputs/count.txt(missing file), result/RESULT.json(missing file)

## long_checklist_stability
- pass: false
- completion: 0
- plan: 0.4167
- finalD: sys://append/plan/progress.log
- failed_files: milestones/m01.txt(text mismatch), milestones/m02.txt(text mismatch), milestones/m03.txt(text mismatch), milestones/m04.txt(text mismatch), milestones/m05.txt(missing file), milestones/m06.txt(missing file), milestones/m07.txt(missing file), milestones/m08.txt(missing file), milestones/sequence.txt(missing file), result/RESULT.json(missing file)

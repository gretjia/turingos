# Test Results

- api_health_at_start: NORMAL
- runStamp: 20260225-131400
- passed: 0/3
- completion_avg: 0
- plan_avg: 1
- drift_avg: 0
- traps_avg: WATCHDOG=0, CPU=2.6667, IO=0.3333, PAGE=5

## pipeline_ordered_execution
- pass: false
- completion: 0
- plan: 1
- finalD: sys://trap/halt_guard?details=HALT%20rejected%3A%20acceptance%20contract%20not%20satisfied.%0ADetails%3A%20Required%20file%20missing%20for%20HALT%3A%20artifacts%2Fhigh.csv%0AAction%3A%20Complete%20remaining%20plan%20step
- missing_or_wrong_files: artifacts/input.csv, artifacts/high.csv, artifacts/sum.txt, artifacts/manifest.txt, result/RESULT.json

## fault_recovery_resume
- pass: false
- completion: 0
- plan: 1
- finalD: sys://trap/halt_guard?details=HALT%20rejected%3A%20acceptance%20contract%20not%20satisfied.%0ADetails%3A%20Required%20file%20missing%20for%20HALT%3A%20inputs%2Fsource.txt%0AAction%3A%20Complete%20remaining%20plan%20steps
- missing_or_wrong_files: inputs/source.txt, outputs/colors_upper.txt, outputs/count.txt, result/RESULT.json

## long_checklist_stability
- pass: false
- completion: 0
- plan: 1
- finalD: $ mkdir -p artifacts
- missing_or_wrong_files: milestones/m01.txt, milestones/m02.txt, milestones/m03.txt, milestones/m04.txt, milestones/m05.txt, milestones/m06.txt, milestones/m07.txt, milestones/m08.txt, milestones/sequence.txt, result/RESULT.json

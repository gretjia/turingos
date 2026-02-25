# Test Results

- api_health_at_start: NORMAL
- runStamp: 20260225-133614
- passed: 0/3
- completion_avg: 0
- plan_avg: 0.5278
- drift_avg: 0
- traps_avg: WATCHDOG=0, CPU=0, IO=6.3333, PAGE=5

## pipeline_ordered_execution
- pass: false
- completion: 0
- plan: 0.5714
- finalD: sys://trap/io_fault
- failed_files: artifacts/input.csv(text mismatch), artifacts/high.csv(text mismatch), artifacts/sum.txt(text mismatch), artifacts/manifest.txt(missing file), result/RESULT.json(missing file)

## fault_recovery_resume
- pass: false
- completion: 0
- plan: 0.4286
- finalD: $ echo 'Popping call stack to handle TRANSFORM step'
- failed_files: inputs/source.txt(text mismatch), outputs/colors_upper.txt(missing file), outputs/count.txt(missing file), result/RESULT.json(missing file)

## long_checklist_stability
- pass: false
- completion: 0
- plan: 0.5833
- finalD: milestones/m07.txt
- failed_files: milestones/m01.txt(text mismatch), milestones/m02.txt(text mismatch), milestones/m03.txt(text mismatch), milestones/m04.txt(text mismatch), milestones/m05.txt(text mismatch), milestones/m06.txt(text mismatch), milestones/m07.txt(missing file), milestones/m08.txt(missing file), milestones/sequence.txt(missing file), result/RESULT.json(missing file)

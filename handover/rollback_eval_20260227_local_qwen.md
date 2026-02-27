# Rollback Evaluation (2026-02-27, local qwen2.5:7b)

## Baseline
- main HEAD (baseline): `90aeac7` (`90aeac7a842d8091c7e5b1c033985e215ad9eb93`)
- policy: no effective uplift => rollback to baseline

## Experiment Build
- experiment branch: `exp/local-qwen-rescue-20260227`
- experiment commit: `e3fd92a`
- patch scope:
  - `src/oracle/turing-bus-adapter.ts`
    - ollama-only mixed-domain sanitizer for VLIW (`mind_ops/world_op` re-routing)
  - `src/kernel/engine.ts`
    - trap breaker on repeated identical trap signatures

## Local Gate on VM (compile/protocol)
- `npm run -s typecheck`: PASS
- `npm run -s bench:turing-bus-conformance`: PASS
- `npm run -s bench:syscall-schema-gate`: PASS

## Mac Real Run (same model/config)
Environment:
- oracle=openai (ollama endpoint)
- model=`qwen2.5:7b`
- baseURL=`http://127.0.0.1:11434/v1`

### Baseline vs Experiment
1. Precheck (24 samples)
- baseline: validRate=0.7917 (19/24)
- experiment: validRate=0.7917 (19/24)
- delta: 0

2. Realworld 40 ticks request
- baseline: ticksObserved=33, pass=false
- experiment: ticksObserved=23, pass=false
- delta: -10 (regression)

3. Realworld 120 ticks request
- baseline: ticksObserved=19, pass=false
- experiment: ticksObserved=76, pass=false
- delta: +57 (partial uplift)

4. Architect evidence gates
- VLIW combo evidence: baseline=false, experiment=false
- Chaos paged-flood evidence: baseline=false, experiment=false

## Decision
- verdict: **NO EFFECTIVE UPLIFT** (core delivery gates still fail; 40-tick regresses)
- action: **ROLLBACK EXECUTED**

## Post-Rollback State
- VM repo `/home/zephryj/projects/turingos`: `main@90aeac7`
- Mac repo `/Users/zephryj/work/turingos`: `main@90aeac7`

## Artifacts (copied into handover)
- `handover/audits/localmodel/voyager_local_precheck_20260227_172404.json`
- `handover/audits/localmodel/voyager_realworld_eval_20260227_172531.json`
- `handover/audits/localmodel/voyager_realworld_eval_20260227_172642.json`

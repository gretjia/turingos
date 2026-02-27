# Voyager Local Model Stage Report (Mac + Ollama qwen2.5:7b)

## Scope
- Host: Mac (`/Users/zephryj/work/turingos`)
- Local model: `qwen2.5:7b` via Ollama (`http://127.0.0.1:11434/v1`)
- Oracle mode: `openai` (OpenAI-compatible local endpoint)
- Objective: run staged gate (`precheck -> 40 ticks -> 120 ticks`) after VLIW/Chaos code hardening.

## Stage Results

1. Precheck (24 samples)
- Result: PASS
- validRate: `0.7917` (19/24)
- mindOpCount: `16`
- worldOpCount: `11`
- comboEditPushExecCount: `8`
- Artifact: `benchmarks/audits/protocol/voyager_local_precheck_20260227_165527.json` (copied to handover localmodel)

2. Voyager Realworld (40 ticks request)
- Result: FAIL
- ticksObserved: `33`
- vliwEvidence.found: `false`
- chaosEvidence.pagedFloodDetected: `false`
- context stats: `min=741 max=1362 avg=931.88 p95=1362`
- Artifact: `benchmarks/audits/longrun/voyager_realworld_eval_20260227_165655.json` (copied to handover localmodel)

3. Voyager Realworld (120 ticks request)
- Result: FAIL
- ticksObserved: `19`
- vliwEvidence.found: `false`
- chaosEvidence.pagedFloodDetected: `false`
- context stats: `min=748 max=1359 avg=950.42 p95=1359`
- Artifact: `benchmarks/audits/longrun/voyager_realworld_eval_20260227_165944.json` (copied to handover localmodel)

## Key Runtime Observations
- Local repair loop in `UniversalOracle` is active on Ollama path (`repair parse failed attempt=1/2,2/2` logs visible).
- Failure remains dominated by dynamic instruction-domain confusion under runtime feedback (CPU fault / trap loops).
- O(1) context bound remains stable (all p95 << 4K hard wall), but world-path evidence is still not produced.

## Gemini Recursive Audit
- Report: `handover/audits/recursive/voyager_local_recursive_audit_20260227_2pass.md`
- Conclusion: `NOGO`
- Blocking conditions:
  - no valid VLIW combo evidence in longrun
  - no chaos paged-flood evidence
  - early trap-loop termination before required tick horizon

## Code Changes This Phase
- `src/oracle/universal-oracle.ts`
  - add Ollama-only schema-repair retry loop (`TURINGOS_OLLAMA_REPAIR_ENABLED`, `TURINGOS_OLLAMA_REPAIR_MAX_ATTEMPTS`)
- `src/bench/voyager-local-precheck.ts` (new)
  - local precheck gate for JSON/VLIW conformance before longrun
- `package.json`
  - add `bench:voyager-local-precheck`

## Next Recommended Actions
1. Add fail-closed instruction-domain sanitizer before kernel dispatch (mind/world auto-separation repair) for small local models.
2. Add trap-loop circuit breaker (same trap signature threshold -> forced strategy jump) before panic reset saturation.
3. Re-run staged gate on Mac with same model after sanitizer + trap-breaker.

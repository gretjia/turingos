# Dual-LLM QWQ Parser Upgrade Phase Audit (2026-02-28)

## Goal
Enable strict single-frame runtime to work with Planner=`qwq:32b` (Mac) + Worker=`qwen2.5:7b` (Linux), without relaxing fail-closed ABI constraints.

## Changes Applied

1) Parser hardening (strict but compatible)
- File: `src/oracle/turing-bus-adapter.ts`
- Added `stripLeadingReasoningBlocks()`:
  - Strips only leading `<think>...</think>` / `<thought>...</thought>` blocks.
  - Keeps strict JSON-frame enforcement for remaining content.
  - Extra non-JSON chatter remains rejected.

2) Bus schema drift fix
- File: `schemas/turing-bus.frame.v2.json`
- Added `SYS_MAP_REDUCE` to `MIND_SCHEDULING` so schema matches runtime opcode set.

3) Conformance fixture refresh
- File: `src/bench/turing-bus-conformance.ts`
- Added valid case with `<think>` prefix.
- Replaced stale legacy-accept case with strict VLIW world-only case.
- Adjusted invalid opcode reject fixture.

## Verification Results

### A) Protocol conformance gate
- Command: `npm run -s bench:turing-bus-conformance`
- Result: PASS
- Report: `benchmarks/audits/protocol/turing_bus_conformance_20260228_140207.json`

### B) Dualbrain million-baseline smoke (1 case)
- Command family: `bench:million-baseline-compare --modes turingos_dualbrain --max-tests 1 --target-tests 1000000`
- Planner: `qwq:32b` via mac tunnel (`127.0.0.1:11434`)
- Worker: `qwen2.5:7b` via linux tailnet (`100.64.97.113:11434`)
- Result: PASS (1/1)
- Report: `benchmarks/audits/baseline/million_baseline_compare_20260228_140606.json`

## Observed Residual Risk
- Runtime still logs intermittent:
  - `[oracle:ollama] repair parse failed; attempt=...`
- Interpretation:
  - Parser compatibility for reasoning preamble is fixed.
  - Planner occasionally emits non-conformant payload requiring local repair loop.
  - At smoke scale, system converges and passes.

## PASS/FAIL (Phase Objective)
- Objective: get `qwq:32b + qwen2.5:7b` strict runtime smoke to pass without topology relaxation.
- Verdict: PASS (with warning)
  - PASS evidence: conformance gate + dualbrain 1-case pass.
  - Warning: parse-repair churn still present; should be reduced before longrun/wild phases.

## Recommended Next Step
- Keep current parser change.
- Add planner-side output shaping/prompt hardening for VLIW JSON ABI to reduce repair churn before moving to longrun and wild-oss phases.

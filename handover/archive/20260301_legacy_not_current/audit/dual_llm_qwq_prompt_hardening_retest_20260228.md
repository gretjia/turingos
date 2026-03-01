# Dual-LLM QWQ Prompt-Hardening Retest (2026-02-28)

## Objective
Reduce parser-repair churn for Planner=`qwq:32b` under strict single-frame ABI without relaxing fail-closed schema.

## Hardening Applied
- File: `src/oracle/universal-oracle.ts`
- Added strict output contract wrapper for all system prompts:
  - Enforce single JSON object only.
  - Explicitly forbid markdown/prose/XML tags.
  - Embed exact syscall envelopes (`SYSCALL_EXACT_FIELD_PROMPT_LINES`).
  - Explicitly forbid extra keys (`args,file,offset,line,column,explanation,analysis`).

## Validation

### 1) Type safety
- Command: `npm run -s typecheck`
- Result: PASS

### 2) Protocol gate
- Command: `npm run -s bench:turing-bus-conformance`
- Result: PASS
- Report: `benchmarks/audits/protocol/turing_bus_conformance_20260228_140806.json`

### 3) Dualbrain smoke retest (qwq planner)
- Command family: `bench:million-baseline-compare --modes turingos_dualbrain --max-tests 1 --target-tests 1000000`
- Planner: `qwq:32b` (mac)
- Worker: `qwen2.5:7b` (linux)
- Result: PASS (1/1)
- Report: `benchmarks/audits/baseline/million_baseline_compare_20260228_141109.json`

## Key Evidence Delta vs Previous Run
- Previous run had repeated `[oracle:ollama] repair parse failed` logs and red-flag traps in workspace journal.
- Retest run:
  - No `repair parse failed` lines in command output.
  - No `HYPERCORE_RED_FLAG` entries in `benchmarks/tmp/baseline_dualbrain/case_000001/.journal.log`.

## Verdict
- Phase verdict: PASS
- Residual note: still smoke-scale only; longrun/wild phases still require recursive audit gates.

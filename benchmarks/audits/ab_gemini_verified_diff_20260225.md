# A/B + Gemini Code Diff Audit (Verified)

- Date: 2026-02-25
- Context: `npm run bench:os-longrun`
- Result snapshot: `turingclaw 3/3` vs `turingos 0/3`

## Verified high-impact code deltas

1) HALT gate strictness (critical)
- turingos blocks HALT without verification evidence and contract completion.
- Evidence:
  - `/home/zephryj/projects/turingos/src/kernel/engine.ts:218`
  - `/home/zephryj/projects/turingos/src/kernel/engine.ts:241`
  - `/home/zephryj/projects/turingos/src/kernel/engine.ts:618`
- turingclaw halting policy is permissive:
  - `/home/zephryj/projects/turingclaw/server/control/halt_protocol.ts:6`

2) Execution contract + progress strictness (critical)
- turingos enforces ordered `DONE:<STEP>` and halt-time completion checks.
- Evidence:
  - `/home/zephryj/projects/turingos/src/kernel/engine.ts:71`
  - `/home/zephryj/projects/turingos/src/runtime/file-execution-contract.ts:69`
  - `/home/zephryj/projects/turingos/src/runtime/file-execution-contract.ts:104`
- turingclaw engine has no equivalent contract gate in tick loop:
  - `/home/zephryj/projects/turingclaw/server/engine.ts:53`

3) Short-loop trap sensitivity (high)
- turingos triggers `L1_CACHE_HIT` with depth=3.
- Evidence:
  - `/home/zephryj/projects/turingos/src/kernel/engine.ts:27`
  - `/home/zephryj/projects/turingos/src/kernel/engine.ts:299`
- turingclaw watchdog thresholds are wider (12/10/12 windows).
- Evidence:
  - `/home/zephryj/projects/turingclaw/server/control/progress_watchdog.ts:42`
  - `/home/zephryj/projects/turingclaw/tests/new/control_benchmark_real_llm.ts:628`

4) Missing-file handling semantics (high)
- turingos turns missing file into `[OS_TRAP: PAGE_FAULT]` context.
- Evidence:
  - `/home/zephryj/projects/turingos/src/kernel/engine.ts:57`
  - `/home/zephryj/projects/turingos/src/kernel/engine.ts:60`
- turingclaw returns simple `[FILE_NOT_FOUND]`.
- Evidence:
  - `/home/zephryj/projects/turingclaw/server/adapters/manifold.ts:132`

5) Write payload filtering (high)
- turingos blocks placeholder-like writes (`CONTENT_CONTRACT_VIOLATION`).
- Evidence:
  - `/home/zephryj/projects/turingos/src/kernel/engine.ts:366`
  - `/home/zephryj/projects/turingos/src/kernel/engine.ts:654`
- turingclaw writes payload directly.
- Evidence:
  - `/home/zephryj/projects/turingclaw/server/engine.ts:61`

6) replace/append syscall strictness (medium-high)
- turingos append duplicate blocked and replace failures throw hard errors.
- Evidence:
  - `/home/zephryj/projects/turingos/src/manifold/local-manifold.ts:76`
  - `/home/zephryj/projects/turingos/src/manifold/local-manifold.ts:321`
  - `/home/zephryj/projects/turingos/src/manifold/local-manifold.ts:355`
- turingclaw uses direct write path.
- Evidence:
  - `/home/zephryj/projects/turingclaw/server/adapters/manifold.ts:116`

7) Observation channel overhead (medium)
- turingos injects `[OS_CONTRACT]`, `[L1_TRACE_CACHE]`, `[OS_CALL_STACK]` into `s_t` before oracle call.
- Evidence:
  - `/home/zephryj/projects/turingos/src/kernel/engine.ts:164`
  - `/home/zephryj/projects/turingos/src/kernel/engine.ts:182`

8) MMU truncation policy (medium)
- turingos truncates slices at 3000 chars and appends `MMU_TRUNCATED` trap.
- Evidence:
  - `/home/zephryj/projects/turingos/src/manifold/local-manifold.ts:18`
  - `/home/zephryj/projects/turingos/src/manifold/local-manifold.ts:251`

## Benchmark evaluator strictness delta

- turingos `computePass` requires all of: completion=1, plan=1, halted, no maxTickHit, etc.
- Evidence:
  - `/home/zephryj/projects/turingos/src/bench/os-longrun.ts:561`
- turingclaw pass decision uses simpler halt/anomaly/check/post policy.
- Evidence:
  - `/home/zephryj/projects/turingclaw/tests/new/control_benchmark_real_llm.ts:587`

## Raw evidence artifacts

- A/B table: `/home/zephryj/projects/turingos/benchmarks/audits/ab_turingclaw_vs_turingos_20260225.md`
- Gemini report: `/home/zephryj/projects/turingos/benchmarks/audits/gemini_code_diff_audit_20260225.md`
- turingclaw run report: `/home/zephryj/projects/turingclaw/workspace/benchmarks/control_real_llm/control-real-20260225-164614.json`
- turingos run report: `/home/zephryj/projects/turingos/benchmarks/results/os-longrun-20260225-164728.json`

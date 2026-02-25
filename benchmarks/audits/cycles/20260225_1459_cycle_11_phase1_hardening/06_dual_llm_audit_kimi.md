## 1. Root Cause Diagnosis (Ranked)

**RC1: File-execution contract state machine desynchronization**
- Evidence: "required file content mismatch for DONE:WRITE_INPUT -> artifacts/input.csv" + completion_avg oscillating 0.0000–0.0833
- The `file-execution-contract.ts` enforces strict DONE:Mxx→file artifact coupling, but the oracle/kernel boundary is emitting milestone strings ("Milestone 01: Initialization complete...") without synchronizing file system state. Round3's watchdog_avg 0.6667 with WATCHDOG_NMI reappearance indicates the contract stalls waiting for file artifacts that exist but fail hash/content validation, triggering NMI timeout.

**RC2: Universal oracle prompt→plan grounding degradation**
- Evidence: plan_avg trajectory 0.377 → 0.4048 → 0.2183 → 0.1706
- `universal-oracle.ts` hardening introduced stricter plan validation that filters valid plans as non-compliant. Round1's plan_avg spike to 0.4048 with 0.0000 completion suggests the oracle now generates plans that pass internal validation but fail execution-phase contract checks. Round2–3 show over-correction: plans are increasingly conservative and incomplete.

**RC3: Kernel engine watchdog timeout misconfiguration**
- Evidence: WATCHDOG_NMI reappeared in round3 despite hardening
- `engine.ts` modifications likely adjusted timeout thresholds without accounting for file I/O latency under contract validation. The 0.6667 watchdog_avg with 0.0000 completion indicates the engine kills runs that would eventually complete, masking underlying progress.

---

## 2. Continue This Code Path?

**No.**

**Criteria violated:**
- Pass rate: 0/3 across 4 consecutive cycles (baseline + 3 rounds)
- Completion_avg: No sustained improvement; oscillates near floor
- Regression signal: WATCHDOG_NMI reappearance after hardening indicates fix fragility
- Plan degradation: Monotonic decline 0.377 → 0.1706 shows hardening is damaging oracle capability

---

## 3. Next-Cycle Design (5 Changes)

| # | Change | Target Component | Evidence Tie |
|---|--------|------------------|------------|
| 1 | Decouple milestone emission from file artifact validation; emit DONE:Mxx immediately on semantic completion, validate files asynchronously | `file-execution-contract.ts` | Eliminates "Progress strictly requires DONE:M01, got..." mismatch |
| 2 | Replace content-hash file validation with existence+size checks; defer content validation to post-completion audit | `file-execution-contract.ts` | Fixes WRITE_INPUT mismatch without blocking progress |
| 3 | Revert oracle plan validator to cycle10 baseline; apply hardening only to output parsing, not plan generation | `universal-oracle.ts` | Halts plan_avg degradation (0.377 baseline recoverable) |
| 4 | Implement staged watchdog: 2x timeout for initialization phase (M01), 1x for execution; NMI only on total deadlock | `engine.ts` | Prevents WATCHDOG_NMI on slow-but-valid file I/O |
| 5 | Add execution trace logging at contract boundary; emit structured state machine transitions for audit | `engine.ts`, `file-execution-contract.ts` | Enables root cause identification without 3-round iteration |

---

## 4. Kill-Switch Conditions

| Condition | Metric Threshold | Action |
|-----------|-----------------|--------|
| Pass rate | < 1/3 after next cycle | Abandon phase1_hardening branch; revert to cycle10 baseline |
| Plan_avg | < 0.15 (further degradation from 0.1706) | Oracle architecture failure; escalate to model/prompt redesign |
| WATCHDOG_NMI | Any reappearance | Engine timeout logic fundamentally incompatible with contract; freeze engine.ts changes |
| Completion_avg | No increase above 0.0833 | File-execution contract approach invalid; pivot to stateless execution model |

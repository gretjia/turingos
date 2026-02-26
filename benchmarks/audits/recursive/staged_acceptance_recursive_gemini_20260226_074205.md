# Recursive Audit Report: Phase 1 Hardening & AC2.1 Resolution

**Date:** 2026-02-26
**Target:** TuringOS Phase 1 Hardening (Recursive Audit Loop)

## 1. Verdict
**GO**

The codebase modifications successfully resolve the critical AC2.1 false-positive issue. The kernel's frame assembly mechanism now rigorously protects the `OBSERVED_SLICE` from being starved by overflowing contextual channels (like `OS_CALL_STACK`), guaranteeing that physical observations are preserved within the `4096` character hard limit. The staged acceptance suite cleanly passes all Phase 1-3 active criteria.

## 2. Findings (Ordered by Severity)

### 2.1 Resolved: AC2.1 Frame Starvation (Critical - Fixed)
*   **Context:** Previously, an overgrown call stack could push the actual physical observation (`OBSERVED_SLICE`) completely out of the context window before the hard limit truncated the frame, resulting in a false-positive OOM Shield pass where the ALU was effectively blinded to the physical world.
*   **Resolution:** The `TuringEngine` now implements a deterministic section-budgeting algorithm in `composeOracleFrame`. Specific limits are enforced for metadata (`oracleContractMaxChars = 640`, `oracleL1TraceMaxChars = 320`, `oracleCallStackMaxChars = 768`). This mathematically guarantees at least ~2,200 characters for the `OBSERVED_SLICE`, preventing starvation.
*   **Validation:** `ac21()` now asserts `observedSourceSeen` (`frame.includes('Source=file:logs/huge.log')`) alongside `hardwallVisible` and length constraints.
*   **Evidence:** `src/kernel/engine.ts`, `src/bench/staged-acceptance-recursive.ts`.

### 2.2 Replay Runner Maturation (Low)
*   **Context:** AC3.2 (Bit-for-bit Replay) is passing and hash consistency is achieved across simulated runs.
*   **Risk/Observation:** The test currently operates on a cleanly executed loop. It does not yet cross-validate against a dirty trace interrupted by `kill -9`.
*   **Evidence:** `src/bench/staged-acceptance-recursive.ts` (AC3.2 implementation).

### 2.3 System Telemetry & Long-run Observability (Low)
*   **Context:** AC2.3 successfully monitors API token consumption, proving O(1) stability dynamically over 500 ticks.
*   **Risk/Observation:** The reporting is currently decoupled from standard CI runs and remains mostly inside the acceptance script rather than integrated as a baseline telemetry gate.
*   **Evidence:** `benchmarks/audits/recursive/staged_acceptance_recursive_20260226_074205.json`.

---

## 3. Evidence Matrix

| Component | File Reference | Status / Notes |
| :--- | :--- | :--- |
| **Topology** | `topology.md` | Reflects correct Layer 3 / Layer 2 boundaries and definitions. |
| **Engine Frame Builder** | `src/kernel/engine.ts` | Implements `composeOracleFrame` with isolated `clipFrameSection` logic. |
| **Manifold Pagination** | `src/manifold/local-manifold.ts` | Properly enforces `maxCallStackDepth` (64) to prevent unbound growth prior to engine ingestion. |
| **Test Harness** | `src/bench/staged-acceptance-recursive.ts` | `ac21` tightened. Added `observedSourceSeen` check. |
| **Audit Result** | `benchmarks/audits/recursive/staged_acceptance_recursive_20260226_074205.json` | S1, S2, S3 all PASS (9/9). S4 and VOYAGER remain appropriately BLOCKED. |

---

## 4. Residual Risks

*   **Boundary Conditions in Payload Clipping:** While `composeOracleFrame` safely truncates strings using limits, highly structured JSON observation slices (if introduced later) might be truncated mid-object, breaking down-stream ALU parsers relying on valid JSON. The current text-based paging gracefully degrades.
*   **Trap Loop Edge Cases:** The `trackTrapPointerLoop` correctly catches pure cyclic pointers, but oscillating state loops (A -> B -> A) that aren't tied strictly to trap channels might bypass the `l1TraceCache` if they exceed the depth limit (`l1TraceDepth = 3`).

## 5. Next Fixes / Roadmap

Following the guidance extracted from the `staged_acceptance_recursive` output, the next logical steps for the immediate future are:

1.  **Replay Runner Hardening:** Supplement AC3.2 by testing bit-for-bit replay on the dirty `trace.jsonl` produced specifically by the AC3.1 `kill -9` Lazarus test.
2.  **Telemetry Integration:** Integrate the `AC2.3` O(1) Entropy token validation checks directly into the `os-longrun` CI gates.
3.  **Phase 4 Unblocking:** Begin constructing the trace data pipeline to unblock AC4.1 (Zero-Prompt Instinct) by converting verified `REPLAY_TUPLE` streams into SFT datasets.

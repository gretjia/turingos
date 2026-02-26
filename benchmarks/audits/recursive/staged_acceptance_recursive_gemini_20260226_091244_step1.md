Based on a recursive review of the source files and the latest AC execution logs, here is the audit report for Step-1:

### Verdict
**GO**

### Findings by Severity
* **P0 (Critical)**: None.
* **P1 (High)**: None.
* **P2 (Medium)**: None.
* **P3 (Low)**: In `src/bench/replay-runner.ts`, `verifyFrameHashes` and `verifyMerkleChain` use conditional checks (e.g., `if (frame.h_q !== undefined)`). This means if a malformed trace completely omits these fields, it might fail open (skip the check) rather than fail closed, though `TuringEngine` currently always writes these properties.

### Evidence Paths
1. **SYS_EXEC Replayed via Snapshot Injection (No Host Execution)**: 
   - **Confirmed:** `src/bench/replay-runner.ts` blocks host execution for `SYS_EXEC` (it just returns the expected pointer).
   - **Confirmed:** Loop over frames in `runReplay` enforces that any frame with a `d_t` starting with `$` must have a valid `observed_slice` or `s_t`.
   - **Evidence:** The AC3.2 JSON output (`staged_acceptance_recursive_20260226_091244.json`) shows `execSnapshotFrames=1` and `mutationArtifactExists=false`, proving the snapshot is read and no actual mutation occurs.
2. **Per-tick `h_q`/`h_s` Verification**: 
   - **Confirmed:** `verifyFrameHashes(frame, i)` in `replay-runner.ts` performs `sha256(frame.q_t) === frame.h_q` and `sha256(frame.s_t) === frame.h_s` for every tick.
   - **Evidence:** AC3.2 outputs `qs=true` for both synthetic and dirty traces.
3. **Per-tick Merkle Chain Verification & Kill-9 Continuity**:
   - **Confirmed:** `verifyMerkleChain` accurately builds the payload hash and rolls `prev_merkle_root` -> `merkle_root` in a continuous chain.
   - **Confirmed:** `kill-9` continuity works because `src/kernel/engine.ts` (`ensureReplayCursorLoaded`) correctly pulls the latest `tickSeq` and `merkleRoot` via `src/chronos/file-chronos.ts:readReplayCursor` on initialization.
   - **Evidence:** AC3.2 reports `dirtyPass=true` and `merkle=true` on the `kill-9` dirty trace generated from AC3.1.
4. **AC3.2 Evidence Trustworthy**: 
   - **Confirmed:** The `staged_acceptance_recursive_20260226_091244.json` proves a comprehensive suite of validations (synthetic, dirty `kill-9`, and mock snapshot injection) executed successfully with matching tree hashes (`hash1 === hash2 && hash1 === sourceHash`).

### Residual Risks
* **Permissive Type Parsing:** The `parseReplayTuple` in `replay-runner.ts` allows `h_q`, `h_s`, and `merkle_root` to be undefined. If a log gets corrupted, the runner might skip hashing assertions instead of throwing an explicit `[CORRUPTION]` error.

### Next Fixes
* **Strict Type Enforcement:** Update `parseReplayTuple` in `src/bench/replay-runner.ts` to throw immediately if `h_q`, `h_s`, `leaf_hash`, or `merkle_root` are missing, changing the behavior from fail-open to fail-closed. 
* **CI Integration:** Integrate the dirty-trace replay check seamlessly into the standard test gate to prevent any regression of the continuity logic.

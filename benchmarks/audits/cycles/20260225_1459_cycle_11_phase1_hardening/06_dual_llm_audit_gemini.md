### 1. Root cause diagnosis (top 3, ranked)

1. **Brittle Progress Payload Parsing (First-Line Strictness):** In `src/kernel/engine.ts`, the `normalizeProgressPayload` function isolates the very first non-empty line of the `s_prime` payload using `.find(line => line.length > 0)`. If the LLM prepends conversational text (e.g., "Milestone 01..."), the parser immediately evaluates and rejects it, ignoring any valid `DONE` markers later in the payload. This directly causes **Evidence 2** ("got \"Milestone 01: ...\"").
2. **Over-strict Exact File Matching:** In `src/runtime/file-execution-contract.ts`, the `checkStepReady` function uses a rigid byte-for-byte comparison (`actual !== expected`) for text artifacts. Because LLMs natively introduce slight variances in formatting, whitespace, or trailing newlines, the execution is blocked. This causes **Evidence 1** ("required file content mismatch").
3. **Trap-Induced Watchdog Loops:** When the engine traps the LLM for the strict validation failures above, the LLM often attempts to retry the append or write operation with the exact same `d_next` and `s_prime`. The `actionSignature` hashes this identical state, and after 5 retries, the `watchdogDepth` limit is reached, causing the kernel to panic. This directly causes **Evidence 3** (`WATCHDOG_NMI` reappeared in round3).

### 2. Should we keep iterating on this code path?

**No.**

**Criteria:** The phase 1 hardening actively broke the workflow. The `completion_avg` plummeted from an already low 0.0833 down to 0.0000, while the `watchdog_avg` spiked to 0.6667. Attempting to force byte-level determinism and strict single-line payload formatting on a non-deterministic LLM is an architectural anti-pattern. Further tightening of exact-match validations will only yield more brittle edge cases and infinite loops.

### 3. Next-cycle design (max 5 actionable changes)

1. **Scan All Lines for Progress Markers:** In `TuringEngine.normalizeProgressPayload`, remove the `.find(line => line.length > 0)` constraint. Iterate through all lines of the payload and accept the write if *any* line matches the `DONE:${nextRequiredDone}` pattern.
2. **Relax Text Expectations to Substring Matching:** In `FileExecutionContract.checkStepReady`, replace the `actual !== expected` equality check with `actual.includes(expected.trim())` or a robust regex matcher to tolerate LLM whitespace and formatting drift. 
3. **Provide Actionable Mismatch Diffs:** When a text or JSON expectation fails in `checkStepReady`, replace the generic 180-character `preview()` string with a specific subset diff (e.g., "Missing expected JSON key 'X'" or "Missing substring 'Y'"). The current trap lacks the precision needed for the LLM to self-correct.
4. **Decouple Artifact Verification from Append Operation:** The `enforceStepArtifactBeforeDone` method currently traps the `sys://append/` operation if the *previous* file write was imperfect. Shift artifact verification to the time the artifact is written (`$ ` command or file pointer write), rather than failing the subsequent progress log append, which confuses the model's action stack.

### 4. Kill-switch conditions (when to stop this direction)

- The `completion_avg` remains at 0.0000 for one more benchmark cycle.
- The `watchdog_avg` remains > 0.50, indicating the engine is spending the majority of its execution ticks trapped in validation feedback loops rather than making forward progress.
- `PLAN_CONTRACT` and `IO_FAULT` traps account for more than 40% of all kernel transitions, proving the contract specifications are too rigid for the underlying model capabilities.

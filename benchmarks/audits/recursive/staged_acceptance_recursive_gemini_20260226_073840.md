### Verdict: NO-GO

The acceptance evidence for AC2.1 is fundamentally flawed. While the test reports `PASS`, the architectural implementation contains a critical defect where the OOM Shield (`applyOracleFrameHardLimit`) indiscriminately truncates the frame from the bottom. Because the `[OBSERVED_SLICE]` is placed at the end of the frame, the ALU is effectively blinded to environment feedback when managed contexts (like the call stack) grow large. The acceptance gate is yielding false positives.

### Findings

**1. Critical: OOM Shield Destroys Observation Visibility**
The `applyOracleFrameHardLimit` function blindly truncates `rawOracleFrame` after `budget` characters (4096 chars minus headers/footers). Since `[OBSERVED_SLICE]` (`s_t`) is appended *after* `[OS_CALL_STACK]` and `[OS_CONTRACT]`, any bloat in the call stack causes the actual environment observation to be chopped off. The model receives system context but no operational feedback.

**2. High: AC2.1 Acceptance Gate is a False Positive**
In `src/bench/staged-acceptance-recursive.ts`, the `ac21()` test verifies the OOM shield by asserting `frame.includes('[PAGE_TABLE_SUMMARY]')`. However, because `sys://callstack` exceeds `maxSliceChars` (3000), it *also* returns a page table summary. The test matches the call stack's pagination marker, failing to detect that the target file's observation (`logs/huge.log`) was completely truncated from the frame. The test cannot be trusted.

**3. Medium: Callstack Paging Obscures Active Tasks**
In `LocalManifold`, tasks are appended to the call stack array (`push`), placing the newest tasks at the bottom of the rendered text. When a deep stack (up to 64 frames) exceeds the 3000-character page limit, the most recent active tasks are pushed onto subsequent pages (e.g., Page 4 or 5). Since the ALU only sees Page 1 by default, it loses immediate context of its current active task unless it manually pages the system channel.

### Evidence

- **`src/kernel/engine.ts` (Lines 111-122 & 435-442):**
  Frame concatenation puts `s_t` at the end. Truncation uses `frame.slice(0, budget)`, chopping the bottom.
  ```typescript
  const rawOracleFrame = [ ..., '[OS_CALL_STACK]', callStackSlice, '', '[OBSERVED_SLICE]', s_t ].join('\n');
  ...
  const clipped = frame.slice(0, budget);
  ```

- **`src/manifold/local-manifold.ts` (Lines 44-46 & 318-323):**
  `maxSliceChars` is 3000. `maxCallStackDepth` is 64. A full call stack hits ~12.8KB, forcing `guardSlice` to page the callstack. Newest frames are at the end:
  ```typescript
  const frames = stack.length > 0 ? stack.map((item, idx) => `${idx + 1}. ${item}`).join('\n') : '(empty)';
  ```

- **`src/bench/staged-acceptance-recursive.ts` (Lines 290-297):**
  The `ac21()` assertion is flawed, only checking for any occurrence of the summary tag.
  ```typescript
  const pass = ... frame.includes('[PAGE_TABLE_SUMMARY]') && frame.includes('[OS_FRAME_HARD_LIMIT]') ...
  ```

### Gaps

1. **Static Truncation vs. Dynamic Budgeting:** The kernel lacks intelligent component budgeting. It should prioritize `[OBSERVED_SLICE]` and dynamically truncate peripheral context (L1 cache, contract, callstack) rather than slicing the serialized string payload.
2. **Page Size Mismatch:** `pageSizeChars` (3000) combined with multiple paged channels in a single tick guarantees exceeding the 4096 `oracleFrameHardLimitChars`, meaning deterministic data loss in complex states.
3. **Flawed Assertions:** Acceptance tests validate raw string inclusion instead of parsing and validating the structural integrity of the final LLM frame.

### Next Fixes

1. **Engine Frame Assembly Refactor:** Rewrite `TuringEngine.tick` to allocate character budgets per section (e.g., 2000 chars strictly reserved for `OBSERVED_SLICE`). Truncate `callStackSlice` and `contractSlice` independently *before* joining them.
2. **Reverse Callstack Rendering:** Modify `LocalManifold.renderCallStackSnapshot` to reverse the array (`[...stack].reverse()`) so the most recent active tasks appear at the top of the rendered list (Index 1).
3. **Tighten AC2.1 Gate:** Update `ac21()` in `staged-acceptance-recursive.ts` to explicitly assert that the `logs/huge.log` specific metadata (or a unique string placed at the top of the paged `s_t`) exists in the final `lastFrame`.
4. **Reduce Page Size:** Lower `options.maxSliceChars` in `LocalManifold` (e.g., to 1500 or 2048) to ensure at least one full observation page fits comfortably within the 4096-character engine hard wall alongside standard OS context.

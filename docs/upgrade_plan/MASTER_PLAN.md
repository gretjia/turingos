# TuringOS Architecture Upgrade: Master Execution Plan

**Objective:**
Evolve the TuringOS architecture from a probabilistically vulnerable state to a deterministically verified, isolated, and scalable multi-agent OS.

**Important Constraint:**
All testing and verification must be conducted locally on the `omega-vm`. Do not rely on other nodes initially. Each module and phase must be validated in isolation locally before broader deployment.

---

## Phase 1: P0 - System Survival (Security Isolation & Semantic Consistency)
These immediate fixes address fatal vulnerabilities that cause state pollution, kernel privilege escalation, and instruction set ghost deadlocks.

### Step 1: P0 Fix A - CT-T1 Strict Transactional Atomicity (State Rollback)
*   **Target File:** `src/kernel/scheduler.ts` (or `engine.ts` handling `micro_snapshot`)
*   **Logic Required:** The current snapshot rollback using `cp -a` fails to remove newly created files during a failed tick. Replace this logic with an absolute state wipe. Before restoring from the snapshot, use `find` (excluding `.git` and the snapshot folder) to forcefully delete any non-snapshot/non-git files, followed by restoring the snapshot using a Copy-on-Write (CoW) mechanism or `cp -a`. This ensures `View(W_{t+1})` strictly equals `View(W_t)` on failure.

### Step 2: P0 Fix B - K/W Separation (Kernel/World Isolation)
*   **Target File:** `src/kernel/engine.ts`
*   **Logic Required:** Implement a Virtual File System (VFS) interceptor at the `executeWorldOp` entry. Any file operation (e.g., `SYS_WRITE`, `SYS_READ`) targeting kernel control plane files (paths starting with `.`, `..`, or containing `sys://`) must be intercepted. Return a controlled `status: "error"` (Fail-Closed principle) with a `MUTEX_VIOLATION` message to prevent the LLM from tampering with its own memory or history.

### Step 3: P0 Fix C - ISA Closure Consistency (Ghost Instructions)
*   **Target Files:** `schemas/syscall-frame.v5.json`, `src/kernel/types.ts`, `turing_prompt.sh`
*   **Logic Required:** The `SYS_EXEC_PYTHON` command exists in backend logic but is absent in schema/prompts, causing parsers to reject it and lock up. Add `SYS_EXEC_PYTHON` to the `WorldOpType` type and the JSON schema array. Update `turing_prompt.sh` to document `SYS_EXEC_PYTHON` and strictly warn against modifying `.` prefixed kernel files.

---

## Phase 2: P1 - Consensus Reconstruction (Verification & Copy-On-Write)
Transition from failure-prone "majority voting" to a verified state search utilizing Semantic DMA and optimized O(1) snapshots.

### Step 4: P1 Fix A - Semantic DMA v2 (Proof-Carrying Verifier)
*   **Target Files:** `src/kernel/semantic_dma.ts` (New File), `src/kernel/engine.ts`, `schemas/syscall-frame.v5.json`, `src/kernel/types.ts`
*   **Logic Required:** 
    *   Implement a deterministic Reverse Polish Notation (RPN) sandbox (`verifyProofCarryingDMA`).
    *   LLM workers will no longer output calculated answers; instead, they output a `Witness` (byte span exact extracts and an RPN program).
    *   The kernel must verify the exact byte text against the file hash, then run the RPN program to compute the result safely.
    *   Expose `SYS_DMA_EXTRACT` in the types and schema, then route it in `engine.ts` to call the new verifier sandbox. Any failure leads to a Loud Failure (`status: 'error'`).

### Step 5: P1 Fix B - O(1) Snapshot Strategy (Copy-On-Write)
*   **Target File:** `src/kernel/scheduler.ts`
*   **Logic Required:** Overhaul the I/O-heavy $O(N)$ physical copy for snapshotting. Implement a function to detect the OS environment and use O(1) Copy-on-Write: `cp -ac` for macOS (APFS) or `cp -a --reflink=auto` for Linux (Btrfs/XFS). Apply this to both the snapshot creation and the transactional rollback mechanism to support high-concurrency Monte Carlo Tree Searches.

---

## Phase 3: P2 - Intelligence Scaling (Cognitive Heterogeneity)
Break the covariance limits ($\rho$) of homogenous majority voting by implementing a parallel, preemptive verified search that leverages different temperatures and model engines.

### Step 6: P2 Fix A - Cognitive Router (Cognitive Dithering Engine)
*   **Target File:** `src/oracle/cognitive_router.ts` (New File)
*   **Logic Required:** Build a `CognitiveRouter` component. Based on the worker index and tick count, generate varying `CognitiveProfile` configurations (different model providers, temperatures ranging from a conservative 0.1 to a chaotic 1.3, top-p variables, and a system entropy salt string). This forces the state space search to diverge and prevents identical group-think failures.

### Step 7: P2 Fix B - Dynamic Oracle Interruption
*   **Target File:** `src/oracle/universal-oracle.ts`
*   **Logic Required:** Update `fetchNextFrame` to accept a `CognitiveProfile` and an `AbortSignal`. Prepend the system entropy salt to the prompt. Inject the `AbortSignal` into the `fetch` API call. This is crucial for short-circuiting and killing redundant API requests immediately when a sibling node finds the verified truth.

### Step 8: P2 Fix C - Parallel Verified Search (Scheduler Overhaul)
*   **Target File:** `src/kernel/scheduler.ts`
*   **Logic Required:** Completely overhaul the tick execution method. Use `executeParallelSearch` to spawn $K$ parallel workers, each within its own isolated physical fork directory (`.parallel_fork_wX`) using the fast O(1) snapshot command. Use `Promise.any` to wait for the first worker that successfully passes the `SYS_DMA_EXTRACT` strict verification. Immediately abort all other workers using the `AbortController`, merge the winning fork into the main workspace, and asynchronously clean up the remaining fork directories.

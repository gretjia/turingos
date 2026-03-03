# G1 -> G2 Transition: Debug & Stability Report

**Date**: 2026-03-02
**Phase**: G1 (Deterministic Hardening)
**Status**: IN PROGRESS / STALLING DUE TO PLANNER CAPACITY

## 1. Initial G1 Implementation Review
We successfully implemented all the mathematical constraints demanded by the architecture team for the G1 transition:
- **GBNF Enforced Parsing**: Deployed `llama.cpp` locally on Mac on port `8080` with a strict JSON schema mapped to the Planner's output constraints. Result: `repair parse failed` errors dropped to **0%**.
- **Temperature Dithering**: Rewrote the `scheduler.ts` logic to deterministically calculate a spread of $T=0.1$ to $T=0.7$ for all workers based on a hash of their PID, ensuring maximum cluster entropy.
- **Merkle Tree Workspace Validation**: Implemented a recursive directory hashing utility in the scheduler to catch causality violations.

## 2. Unforeseen High-Concurrency Deadlocks (The Debug Phase)

Upon launching the G1 daemon with the strict mathematical constraints, the test loop (`million-baseline-compare.ts`) began stalling out silently after $N$ cases. We identified and patched four critical engine-level bugs:

### Bug A: The P85 Promise Barrier Infinite Block
- **Symptom**: The orchestrator would freeze randomly if the network connection dropped to a subset of Ollama Workers, despite having a P85 Quorum logic implemented.
- **Root Cause**: The `universal-oracle.ts` fetch layer relied on `AbortSignal.timeout()`, which fails to correctly sever hanging TCP connections inside Node.js 22's `undici` engine under extreme concurrency. Furthermore, `scheduler.ts` used `Promise.all` which permanently blocked the main thread if even one worker locked up and wasn't manually `KILLED`.
- **Fix**: Re-wrote the network fetch wrapper to use a strict `AbortController` combined with a `setTimeout` cleanup. Swapped `Promise.all` to `Promise.allSettled` in the Hypercore run loop so the system can gracefully ignore mathematically-culled stragglers. 

### Bug B: The Map-Reduce Auto-Write Thrashing Loop
- **Symptom**: Planners would get stuck in a `TRAP_THRASHING_NO_PHYSICAL_IO` death-spiral.
- **Root Cause**: If the swarm returned `[NO_VALID_VOTE]` (due to high temperature dithering), the Planner's `autoWriteConsensusOnMapDrop` logic would ignore the result and just continue looping without issuing a physical command to the disk. Furthermore, if it *did* reach a consensus, it would auto-write the `ANSWER.txt` but wouldn't know how to halt, repeating the same steps until the engine killed it.
- **Fix**: Injected a `[SYSTEM RED FLAG]` back into the Planner's state tape if the swarm failed to reach consensus, forcing it to rethink mathematically. Added a programmatic `pcb.state = 'PENDING_HALT'` mutation immediately after the auto-write successfully places the answer on disk.

### Bug C: The Infinite Failure Trap (KILL_AND_FAIL)
- **Symptom**: Test cases would silently run forever, preventing the script from iterating to the next case.
- **Root Cause**: If the swarm reached a strong (but mathematically incorrect) consensus, the Planner would auto-write it and request a HALT. The `HaltVerifier` would run `.turingos_verify_answer.sh`, detect the wrong answer, reject the halt, subtract `1` from the PCB price, and throw the Planner back into the `READY` queue. Because the Planner was fully confident in the swarm's answer, it would just try to halt again with the exact same answer, creating an infinite verification failure loop.
- **Fix**: Implemented a `KILL_AND_FAIL` price threshold limit. If a Planner's state price drops below `-3` (indicating persistent rejection by the physical verifier), the kernel forcibly kills the process, marks the test case as a `FAIL` in the benchmark metrics, and allows the `million-baseline-compare` loop to move on to the next number.

### Bug D: The Zombie Planner Resurrection
- **Symptom**: Planners that hit the `-3` price kill limit would be resurrected, leading to infinite `-8` price failure loops.
- **Root Cause**: A straggler Worker from the `SYS_MAP_REDUCE` call that was dropped/timed out would eventually fire `resolveJoin` asynchronously. The orchestrator's `resolveJoin` method called `schedule(parent)` (which pushes the parent back into the `READY` state queue), failing to check if the parent (Planner) was already `KILLED`. 
- **Fix**: Added `if (pcb.state === 'TERMINATED' || pcb.state === 'KILLED') return;` to the `schedule` kernel call to prevent asynchronous necromancy. 

## 3. Current State & The Ultimate Bottleneck
The TuringOS daemon has been refactored to run as a pure background detached `tmux` shell loop. We migrated execution entirely to `localhost` (Mac) with $K=4$ parallel workers to eliminate Tailscale trans-pacific network timeouts and SSD swap thrashing.

**The user strictly mandated: "The 200 passes must be consecutive and mathematically perfect. Bypassing failures is meaningless."**

After setting `--stop-on-fail`, the system consistently breaks its streak and crashes after only 5-10 tests (e.g., max streak of 5 before failure on case 1164, then failure on case 1176).

**The bottleneck is definitively the Planner's (32B) reasoning capacity, not the Worker count.**

**Evidence:**
When the Worker Swarm entropy is too high and they fail to agree, the Planner receives `[NO_VALID_VOTE]`. The engine correctly flags this and orders the Planner to compute the answer manually:
```typescript
`${q}\n[SYSTEM RED FLAG] The worker swarm failed to reach a numeric consensus. Returned: ${lastConsensus}. Do NOT emit SYS_MAP_REDUCE. You must rethink the problem and use SYS_WRITE.`
```

However, the 32B model, stripped of external consensus and faced with a complex logical task, suffers complete cognitive collapse. Instead of complying and emitting a `SYS_WRITE` calculation, it outputs an empty `{}` JSON payload (a "null" action). It repeats this inaction until the kernel's watchdog kills it:
`[HYPERCORE_TRAP] pid=planner_... details=Error: TRAP_THRASHING_NO_PHYSICAL_IO: 6 ticks without SYS_WRITE/SYS_EXEC/SYS_HALT`

Even in a `qwen_direct` 32B test, the Planner mathematically failed:
`"reason": "mismatch expected=2600 got=2590"`

Scaling Workers to $K=100$ will only *increase* the noise ratio the Planner has to filter. The current Planner acts as a brittle bottleneck in the Asymmetric Discriminator role; if the workers don't hand it a silver platter, it completely locks up rather than recovering.
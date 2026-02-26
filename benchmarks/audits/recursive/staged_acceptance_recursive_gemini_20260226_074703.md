# Verdict: NO-GO

## Findings
1. **[CRITICAL] `SYS_EXEC` Re-execution Violates Layer 4 Offline Determinism**: In `src/bench/replay-runner.ts`, the `applyFrame` function handles `SYS_EXEC` by calling `await manifold.observe(execPointer)`. This actively *re-executes* terminal commands during a replay. True deterministic offline replay (as defined in Layer 4 of `topology.md`) must strictly restore from a static snapshot (the "tape") and never re-evaluate commands that could introduce non-determinism, network calls, or side effects from the chaotic external world.
2. **[HIGH] Blind Spot in Dirty Trace Verification**: The trace verified in AC3.2 comes from AC3.1's `ResumeProcessOracle`, which only issues a read-only `SYS_EXEC` (`cat checkpoint/step1.txt`). Because this command does not mutate the file system, the replay runner's tree hash happens to match the source workspace. If the oracle had issued a mutating command (e.g., `date > out.txt`), the `replay-runner` would execute it again during replay, generating a new timestamp, diverging the hash, and failing the test. The current AC test is masking the re-execution flaw.
3. **[MEDIUM] `d_t` Snapshot Payload Ignored**: The `replay-runner.ts` script parses the `d_t` field from the trace but only uses it as a string pointer. It does not extract or assert against any recorded world snapshot data (the "ADC slice"). This means the replay relies entirely on reproducing steps via the manifold rather than authenticating against the monotonically recorded historical state.

## Evidence
- `topology.md`: Layer 4 requirements ("阻断外部世界的时间流动，确保内核每次读取到的宇宙切片是静态、确定且可重放的" — *Block the time flow of the external world, ensuring the cosmic slice read by the kernel is static, deterministic, and replayable.*).
- `src/bench/replay-runner.ts`: `applyFrame()` switch case for `SYS_EXEC` explicitly triggers live execution (`await manifold.observe(execPointer);`).
- `src/bench/ac31-kill9-worker.ts`: `ResumeProcessOracle` purely issues a read-only `SYS_EXEC` command (`cat checkpoint/step1.txt`), which hides the side-effect divergence during the AC3.2 test.
- `benchmarks/audits/recursive/staged_acceptance_recursive_20260226_074703.md`: Shows AC3.2 passing, but it is a false positive due to the side-effect-free nature of the evaluated traces.

## Residual risks
- **Silent divergence in production replay**: If an agent trace includes complex `SYS_EXEC` calls, an offline replay will either hang, fail (if the network or environment differs), or yield a divergent hash.
- **Accidental host mutation**: Replaying a trace that contains destructive commands (e.g., `rm -rf` or database drops) will actively execute those commands on the host machine running the replay, introducing a massive security and stability risk.

## Next fixes
- **Refactor `replay-runner.ts` to Strict Offline Mode**: Remove the live `manifold.observe` call for `SYS_EXEC`. The runner should replay state changes strictly from the recorded tape or throw an error if attempting to execute a live bash command.
- **Enhance Layer 4 Journaling**: Update the `LocalManifold` and `TuringEngine` to ensure that the file system deltas or outputs resulting from `SYS_EXEC` are captured in the `.journal.log` (or `.journal.merkle.jsonl`). Offline replay should inject these deltas rather than running the command.
- **Strengthen AC3.2 Benchmark**: Update the replay validation harness in `staged-acceptance-recursive.ts` to include a synthetic trace with a mutating `SYS_EXEC` (e.g., `echo $RANDOM > random.txt`). Replay it in an environment where `exec` is stubbed or mocked out to empirically prove the tree hash is restored without invoking external processes.

# Codex Handover Report: P1-P3 Completion & Qwen32B Integration (2026-03-02)

## Current Status & Mission Alignment
We are operating under the "Twin Axioms" of TuringOS (Infinite Time = Turing Completeness; Infinite Workers = Scaling Intelligence). Our primary objective in this cycle was to build the unbreakable physical testing constraints (P1-P3) required to launch the true `1M Test` loop without probability collapse.

As of this writing, **the baseline test is actively running in the background** (`case 1159+` via `daemon_run.log`) using a 16-Worker fixed fanout distributed across Mac and Windows. 

## Completed Actions & Bug Fixes

### 1. Architectural Sandbox Hardening (P1-P3)
- **Phase 1 (Hard Interrupts)**: Implemented aggressive A->B->A dead-loop detection and 2-step repeating trap interrupts inside `engine.ts`. The kernel now injects a `[SYSTEM RED FLAG]` into the LLM context to brutally break hallucination loops.
- **Phase 2 (Physical Ephemeral Workspaces)**: Integrated `TURINGOS_EPHEMERAL_WORKSPACE=1` into `boot.ts`. Each benchmark case now receives a cryptographically unique `run_UUID` directory that is physically deleted (`rm -rf`) after completion, preventing cross-test contamination.
- **Phase 3 (Micro-Snapshots)**: Engineered an absolute filesystem rollback within `applyTransition`. Before any IO-mutating `SYS_WRITE` or `SYS_EXEC` executes, the kernel snapshots the directory. If the worker encounters an unrecoverable crash during execution, the sandbox is instantaneously restored to `N-1` state.

### 2. G0 Stability Seed Enhancements
- **Consensus Sanity Gate**: Discovered that dropping Map-Reduce steps caused Planners to repeatedly attempt to auto-write incorrect mathematical consensus values. Implemented a strict check in `scheduler.ts` that detects rejected whitebox verifications and injects a RED FLAG expressly forbidding the planner from emitting the same mathematically invalid string again.
- **Structured JSON Schema Bugfix**: Disabled `TURINGOS_OPENAI_JSON_SCHEMA_ENABLED=0` within the daemon execution because Ollama's current internal parsing engine crashed (`500 fetch failed`) when heavily nested schemas were enforced. To compensate, I heavily reinforced `SYSCALL_EXACT_FIELD_PROMPT_LINES` to aggressively coerce `Qwen` into the proper `Transition` JSON output.

### 3. Cross-Host GPU Inference Upgrades
- **Windows (128GB APU)**: Attempted to migrate Windows to Xinference to handle massive 100-worker concurrency via vLLM. Discovered deep architectural bugs with XOSCAR multi-processing under native Windows. **Reverted Windows to a robust Ollama service** bound to `100.123.90.25:11434` via Tailscale.
- **Mac (36GB Unified)**: `Qwen3.5:27b` proved incompatible with Ollama's `llama.cpp` wrapper (yielding `unknown model architecture: 'qwen35'`). Successfully deployed **Option A**: Rolled back the Mac planner to the officially supported and highly capable `Qwen2.5-Coder-32B-Instruct` via ModelScope. 

### 4. Resilient SIGHUP Daemonizing
- Built a native `while true` shell-based daemon (`run_baseline_1m_daemon.sh`) utilizing `exec` to run `million-baseline-compare.ts`. Bootstrapped inside a permanent `tmux` session (`turingos_1m_v2`). The testing loop now survives SSH detachment seamlessly and automatically restarts from its checkpoint if the node process crashes due to network timeouts.

## Next Steps for Incoming Agents
1. **Monitor the Longrun**: Check the progress of the `tmux` session and review `/home/zephryj/projects/turingos/benchmarks/audits/baseline/daemon_run.log`. Evaluate if the F1 (Format Drift) hallucination has truly dropped to 0%. 
2. **Grammar Constraints**: Once the current run eventually halts, investigate implementing physical JSON Grammar enforcement inside the Windows/Mac LLM engines (possibly migrating Mac to MLX natively or using `llama.cpp` CLI wrappers) to prevent the LLM from generating `{"answer": ...}` instead of `{"world_op": ...}`.
3. **Execute Phase G2 (Ensemble Lift Validation)**: We must explicitly prove Axiom 2. Modify the benchmark to chart the exact pass rate difference between `worker_parallelism=1` versus `worker_parallelism=16` versus `worker_parallelism=32` to mathematically prove the swarm is outperforming the individual instance.
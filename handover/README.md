# TuringOS Handover Index (AI Agent)

This index is for agents joining the current TuringOS cycle.

## Git-Tracked Mirrors

- Workspace root guide mirror: `./AGENTS_WORKSPACE_ROOT_GUIDE.md`
- Home handover guide mirror: `./AGENTS_HOME_HANDOVER_GUIDE.md`

## Priority Reading Order

- **G2 Execution Debrief & The Qwen 3.5 Upgrade Pathway (2026-03-03):**
  - `./audits/g2_deepthink_debrief_and_qwen35_upgrade_20260303.md`

- **Prompt for DeepThink regarding Hallucination Paradox (2026-03-03):**
  - `./audits/prompt_for_deepthink_20260303.md`

- **G2 Execution Report: Semantic DMA & The Hallucination Horizon (2026-03-03):**
  - `./audits/g2_semantic_dma_execution_report_20260303.md`

- **DeepThink Architectural Response: Semantic DMA (Zero-Touch Data Extraction) (2026-03-03):**
  - `./audits/deepthink_g2_semantic_dma_20260303.md`

- **G2 Integrity Report: Reverting Overfit Cheat (2026-03-03):**
  - `./audits/g2_purity_revert_20260303.md`

- **DeepThink Architectural Response: G1 -> G2 Blueprint (2026-03-03):**
  - `./audits/deepthink_g2_blueprint_20260303.md`

- **Prompt for DeepThink regarding Planner Deadlock (2026-03-02):**
  - `./audits/prompt_for_deepthink_20260302.md`

0. Current G1->G2 Transition Plan & Acceptance Criteria:
   - `./artitecture_response/g1_g2_transition_plan_20260302.md`
1. Emergency system audit (complexity-collapse):
   - `./artitecture_response/chief_architect_system_audit_complexity_collapse_20260301.md`
2. Dual-LLM recursive upgrade execution plan (current cycle):
   - `./artitecture_response/dual_llm_recursive_upgrade_execution_plan_20260301.md`
3. Gemini independent recursive upgrade plan:
   - `./artitecture_response/gemini_recursive_upgrade_plan_from_chief_audit_20260301.md`
4. Latest G0 longrun progress snapshot (fixed-16 run-until-fail):
   - `./artitecture_response/g0_progress_fixed16_longrun_20260301_160614.md`
5. Current blocker and architecture-review summary:
   - `./audits/turingos_arch_review_handover_20260301_035950.md`
6. Total design overview:
   - `../README.md`
7. Topology blueprint:
   - `../topology.md`
8. Network topology runbook (cross-host execution baseline):
   - `./network_topology_runbook_20260301.md`
   - Source workspace: `/Users/zephryj/work/network`
9. Latest architect core design:
   - `./artitecture_response/core_architect_opinion_anti_oreo_v2_20260228.md`
10. Latest architect action plan:
   - `./artitecture_response/dual_llm_joint_action_plan_from_core_opinion_20260228.md`
11. Final success criterion toward 1M steps:
   - `./artitecture_response/final_success_criterion_maker_1m_steps_20260228.md`
12. Baseline comparison evidence:
   - `./audits/modelcompare/main_steps_baseline_20260228.md`
13. Recursive phase gate status:
   - `../benchmarks/audits/phase_gate/recursive_phase_gate_latest.md`

## Current Main Problems

- Context entropy still grows too fast in long-run loops and can starve core objective focus.
- Syscall contract robustness depends too much on prompt compliance instead of hard decoding constraints.
- Dual-brain orchestration can still degrade into loop-like indecision on boundary conditions.
- Cross-case environment isolation and deterministic rollback discipline are not yet complete.

## Control and Compute Role Contract (2026-03-01)

- `omega-vm` is the controller/orchestrator host for this project.
- Local `Mac + Windows` are primary compute hosts (planner/worker serving lanes).
- Do not assume controller-to-compute bulk transfer via tailscale is fast by default.
- For large installers or model artifacts, prefer:
  - Mac download/staging first.
  - Mac LAN (`192.168.3.x`) to Windows LAN (`192.168.3.x`) transfer.
  - Then local archive bootstrap on Windows.

## Temporary Runtime Guard (2026-03-01)

- Temporary worker cap remains available, but is now opt-in (default unlocked).
- Enforcement location: `src/bench/million-baseline-compare.ts` via `resolveTemporaryWorkerCap()`.
- Default behavior:
  - `TURINGOS_BASELINE_TEMP_WORKER_CAP_ENABLED` defaults to `false`.
  - When enabled, `TURINGOS_BASELINE_TEMP_WORKER_CAP_MAX` defaults to `2` when unset.
- To re-enable emergency throttling:
  - Set `TURINGOS_BASELINE_TEMP_WORKER_CAP_ENABLED=true`.
  - Optionally set `TURINGOS_BASELINE_TEMP_WORKER_CAP_MAX=<N>`.

## True Parallel Prep (Mac + Windows, 2026-03-01)

- Kernel now supports true worker parallel execution per cycle via:
  - `TURINGOS_HYPERCORE_WORKER_PARALLELISM` (set by baseline runner).
- Baseline runner now supports worker endpoint pool:
  - `TURINGOS_BASELINE_WORKER_BASE_URLS` (comma-separated OpenAI-compatible endpoints).
  - Routed by round-robin across worker oracles.
- Important distinction:
  - `TURINGOS_BASELINE_WORKER_PARALLELISM` controls scheduler worker lane concurrency.
  - It does **not** by itself force per-case map-reduce fanout.
  - To force fixed per-case fanout in baseline, set:
    - `TURINGOS_BASELINE_WORKER_FANOUT_FIXED=<N>`
- Current integration target (when Windows is free):
  - Mac keeps planner lane.
  - Mac + Windows both serve `qwen2.5:7b` worker endpoints.
  - Start with `worker_parallelism=8`, then `16`, then `32` after stability checks.
- Recommended launch pattern:
  - Mac-only warmup:
    - `TURINGOS_BASELINE_PLANNER_ORACLE=openai`
    - `TURINGOS_BASELINE_PLANNER_MODEL=qwen3.5:27b`
    - `TURINGOS_BASELINE_PLANNER_BASE_URL=http://127.0.0.1:11434/v1`
    - `TURINGOS_BASELINE_WORKER_ORACLE=openai`
    - `TURINGOS_BASELINE_WORKER_MODEL=qwen2.5:7b`
    - `TURINGOS_BASELINE_WORKER_BASE_URL=http://127.0.0.1:11434/v1`
    - `TURINGOS_BASELINE_WORKER_PARALLELISM=4`
  - Mac+Windows worker pool:
    - `TURINGOS_BASELINE_WORKER_BASE_URLS=http://<mac-ip>:11434/v1,http://<windows-ip>:11434/v1`
    - raise `TURINGOS_BASELINE_WORKER_PARALLELISM` stepwise (`8 -> 16 -> 32`).

## Baseline G0 Hard Contract (2026-03-01)

- Baseline arithmetic lane now defaults to strict integer-write enforcement:
  - `TURINGOS_HYPERCORE_STRICT_INTEGER_WRITE_FILES=ANSWER.txt`
  - `TURINGOS_HYPERCORE_STRICT_INTEGER_WRITE_COERCE=0` (default reject non-integer payload)
  - `TURINGOS_HYPERCORE_STRICT_INTEGER_WRITE_EXTRACT_LAST_INT=1` (used only when coerce enabled)
- To reduce post-join planner loop stalls in fixed-fanout mode:
  - `TURINGOS_HYPERCORE_AUTO_WRITE_CONSENSUS_ON_MAP_DROP=1` can auto-write numeric consensus when redundant map-reduce is dropped after a completed join.

## Windows Worker Bootstrap (D Drive + Exit Node)

- Windows fresh machine bootstrap script:
  - `scripts/windows_worker/bootstrap_windows_worker.sh windows1-w1`
- Preferred when Windows external egress is unstable:
  - `scripts/windows_worker/bootstrap_windows_worker_via_mac_lan.sh`
- Script responsibilities:
  - install `ollama.exe` under `D:\work\turingos_llm\bin`
  - start service and pull `qwen2.5:7b`
  - register periodic cleanup task (`TuringOS-Worker-Cleanup`, default every 30 min)
- If direct internet is blocked, switch exit node before bootstrap:
  - `tailscale up --reset --exit-node=100.81.234.55 --exit-node-allow-lan-access --hostname=windows1-w1 --unattended`

## Cleanup Rule (Linux + Windows + Mac)

- After successful bootstrap, remove non-essential install artifacts:
  - Linux: temporary Ollama installers and transfer test shards under `~/tmp/ollama`
  - Windows: stale archives/shards in `D:\work\turingos_llm\downloads` and transient extract dirs
  - Mac: temporary installer shards/caches used only for bootstrap staging
- Keep only runtime binaries, required models, and active logs.

## Directory Rule

- `artitecture_response/`: primary architect-v2 and current-cycle design/audit docs.
- `audits/`: evidence data and benchmark outputs.
- `network_topology_runbook_20260301.md`: canonical cross-host SD-WAN topology and operations baseline.
- `archive/`: legacy or non-current materials (including old `artiteture_response/` and `audit/` bundles); do not use as default source.

## Technical Reserves & Experience

- ModelScope Native (vLLM/Xinference) vs Ollama evaluation for long-term 1M step baseline scaling:
  - `./technical_reserves/modelscope_vs_ollama_research_20260302.md`

- Codex Phase 3 Completion Report (Micro-Snapshot & Absolute Rollback):
  - `./artitecture_response/codex_phase3_completion_20260302.md`

- Codex Workplan (2026-03-02):
  - `./artitecture_response/codex_workplan_20260302.md`

- Codex Workplan (2026-03-02):
  - `./artitecture_response/codex_workplan_20260302.md`

- G0 Progress Snapshot: Fixed-16 Longrun (Qwen32B Planner) - 2026-03-02:
  - `./artitecture_response/g0_progress_fixed16_longrun_q32b_20260302.md`

- TuringOS Core Philosophy & Test Plan Alignment (2026-03-02):
  - `./artitecture_response/turingos_core_philosophy_alignment_20260302.md`

- Codex Handover Report: P1-P3 Completion & Qwen32B Integration (2026-03-02):
  - `./artitecture_response/codex_handover_report_20260302_end_of_day.md`

- DeepThink Architectural Audit & Hardening Directives (G0 -> G1 Transition) - 2026-03-02:
  - `./artitecture_response/deepthink_g1_transition_audit_20260302.md`

## Update 2026-03-03 23:55 +0800 (Mac Inference Node Upgrade: Qwen 3.5 27B)

- **Action**: Upgraded the local planner model on `mac-back` from Qwen 2.5 30B to Qwen 3.5 27B (GGUF Q4_K_M).
- **Reason**: The 30B model hit an adversarial hallucination paradox at the 48-pass mark in the TuringOS loop, bypassing safety regexes via string obfuscation.
- **Execution**: Downloaded via `hf-mirror.com` with `hf_transfer`. Started `llama-server` on the same `0.0.0.0:8080` port.
- **Result**: Smoke test passed successfully with ~13 tokens/sec inference and correct `reasoning_content` output. Cluster ready to resume testing.

## Google Docs CLI Tool
A global CLI tool `gdocs` is available to access and read Google Docs (authenticated via the user's ziqian.jia@gmail.com account).
- `gdocs list` - Lists recent documents with their IDs.
- `gdocs read <ID>` - Outputs the plain text content of a Google Doc.

AI agents can use this tool to fetch requirements, architectures, or context from the user's personal Google Drive.

## Update 2026-03-04 10:30 +0800 (1M Test Progress on Qwen 3.5 27B)

- **Action**: Monitored the ongoing 1M test (`turingos_1m_only` tmux session) running via `mac-back`.
- **Status**: The Qwen 3.5 27B model has successfully surpassed the previous 48-pass failure point (adversarial hallucination paradox).
- **Result**: Currently achieved **62 consecutive passes** without error. The model is correctly outputting Python code and auto-halting. See `./audits/1m_test_qwen35_progress_20260304.md` for details.

## Update 2026-03-06 (1M Test Case 251 Python Exec Sandbox Fix)

- **Action**: Diagnosed and fixed a TuringOS engine bug that caused the 1M baseline test to fail after 65 consecutive passes (case 251).
- **Issue**: Workers correctly wrote `python3 -c "..."` to fulfill zero-touch extraction, but the kernel wrote this literal bash string into a `.py` file, causing a native Python `SyntaxError` and dropping all map-reduce votes.
- **Fix**: Upgraded `src/kernel/scheduler.ts` to properly regex-strip the `python3 -c "..."` wrapper and only write the inner code to the sandbox script. Test 251 passes cleanly now.
- **Details**: `./audits/fix_python_exec_syntax_error_20260306.md`

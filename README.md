# TuringOS: The "Anti-Oreo" Agent Kernel

> **🤖 AI Agents: Read [`AGENTS.md`](./AGENTS.md) first!** That is your primary context and constraints guide for operating in this repository.

TuringOS is a mathematically rigorous, long-horizon agent kernel built to solve the $O(c^N)$ complexity collapse problem in autonomous execution. It is designed to prove the "Twin Axioms" of LLM execution:
1. **Infinite Time = Turing Completeness:** Under TuringOS, an LLM will not randomly drift or recursively collapse. It will eventually solve any computable problem via absolute state rollback, micro-snapshots, and red-flag hard interrupts.
2. **Infinite Workers = Intelligence Scaling:** A massive swarm of low-parameter "Worker Bee" models (e.g., 7B) coordinated by a single large Planner model can rival or exceed the determinism and correctness of a vastly larger model alone.

The system abandons the traditional "chat-loop" agent design and instead operates as a pure deterministic transition kernel:
`delta(q, s) -> (q_next, s_prime, d_next)`
- `q` is the persistent state register (`.reg_q`)
- `d` is the persistent pointer (`.reg_d`)
- `s` is the observed absolute snapshot slice from the current pointer

## 📖 DeepThink Architectural Audit & Index

This repository is heavily documented with its continuous design evolutions and debug loops. To understand the current status, roadblocks, and architectural milestones, please review the following files in exactly this order:

### 1. The Core Philosophy & 1M Growth Design
- **[TuringOS Core Philosophy & Test Plan Alignment](./handover/artitecture_response/turingos_core_philosophy_alignment_20260302.md)** 
  *(The absolute "North Star" mapping out the goals of the 1,000,000 Step baseline).*
- **[Long-Horizon Architecture Review & Anti-Oreo Engine](./handover/audits/long_horizon_architecture_review_20260305.md)**
  *(A philosophical and technical comparison against Codex 5.3 and Kimi 2.5, detailing missing Syscalls for true Github Issue resolution).*
- **[Worker Upgrade: Qwen 3.5 9B & Schema Fixes](./handover/audits/worker_9b_upgrade_20260305.md)**
- **[Goal-Driven 1M Growth Design](./handover/artitecture_response/goal_driven_1m_growth_design_20260301.md)**
- **[Chief Architect System Audit (Complexity Collapse)](./handover/artitecture_response/chief_architect_system_audit_complexity_collapse_20260301.md)**
- **[Latest Architect Core Design (Anti-Oreo Theory)](./handover/artitecture_response/core_architect_opinion_anti_oreo_v2_20260228.md)**

### 2. Execution Reports (Current Cycle: P1-P3)
- **[Phase 3 Completion Report (Micro-Snapshots & Absolute Rollback)](./handover/artitecture_response/codex_phase3_completion_20260302.md)**
  *(Details the critical fixes that stopped the hallucination cascade loops).*
- **[End of Day Handover: P1-P3 & Qwen32B Integration](./handover/artitecture_response/codex_handover_report_20260302_end_of_day.md)**
  *(The comprehensive snapshot of the active baseline loop prior to the Qwen3.5 upgrade).*

### 3. Deep-Dive Hardware & Topologies
- **[TuringOS System Topology Blueprint](./topology.md)**
- **[Network Topology Runbook](./handover/network_topology_runbook_20260301.md)**
- **[Mac Ollama Qwen32B Pivot Plan](./handover/technical_reserves/mac_ollama_qwen32b_plan_20260302.md)** *(Historical context)*
- **[Xinference vs Ollama AMD Strix Halo Plan (Aborted)](./handover/technical_reserves/xinference_amd_strix_halo_plan_20260302.md)** *(Historical context)*

---

## 🚀 Current Project Status (As of 2026-03-03)

The project has successfully bypassed severe architectural blockers, including previous LLAMA.cpp architecture limitations on Mac, and reached the **48-pass limit** before hitting adversarial hallucination fatigue. 

**The physical constraints are active:**
- **Micro-Snapshots**: All filesystem modifications (`SYS_WRITE`, `SYS_EXEC`) take an absolute `.micro_snapshot.tmp`. Any kernel fault during execution triggers a `cp -a` hard rollback to block history pollution.
- **Red Flag Trap Handlers**: A->B->A logic loops and repeated failed consensus numbers are hard-blocked by `[SYSTEM RED FLAG]` injections into the prompt.
- **Dual-Brain Compute**: `omega-vm` operates as the orchestrator. `mac-back` runs **Qwen3.5-27B-Instruct** (upgraded to break the 48-pass ceiling) as the Planner. `windows1-w1` runs a 16-node fixed parallel fanout of `Qwen2.5:7b` Workers.

**Active Mission:**
The `million-baseline-compare.ts` daemon is currently running relentlessly via `tmux` in the background of `omega-vm`. We are actively tracking if the format hallucinations (F1 drift) have dropped to 0%, utilizing the newly upgraded Qwen 3.5 27B architecture on Mac.

---

## 🛠 Directory Layout & Knowledge Base

- `src/kernel/`: The absolute core OS mechanics (`engine.ts` for ticking and snapshots, `scheduler.ts` for parallel compute distribution and consensus gates).
- `src/oracle/`: The API wrapper logic (e.g., `universal-oracle.ts` where the `SYSCALL_EXACT_FIELD_PROMPT_LINES` is injected).
- `src/runtime/`: System bootstrapping and physical UUID ephemeral workspaces (`boot.ts`).
- `handover/`: The comprehensive knowledge base containing all agent handovers, technical reserves, architectural audits, and progress snapshots. **Treat this folder as the system's Long-Term Memory (RAG target).**
- `benchmarks/audits/`: Where the `million_baseline_compare_latest.json` and `failure_artifacts/` are actively logged during the 1M runs.

---

## ⌨️ Quick Start (Developer / Agent)

```bash
npm install
npm run typecheck
```

Launch the continuous 1M baseline test loop (Linux Controller):
```bash
./run_baseline_1m_daemon.sh
```

Execute recursive audit gate to prove Kernel P0-P3 upgrades haven't broken the system logic:
```bash
npm run bench:phase-recursive-audit-gate -- --phase P3 --codex-pass yes --gemini-pass yes --codex-evidence handover/artitecture_response/g0_progress_fixed16_longrun_q32b_20260302.md --gemini-evidence handover/artitecture_response/gemini_rootcause_15pass_20260301.md --note "audit"
```
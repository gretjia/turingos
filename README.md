# TuringOS

TuringOS is a minimal long-horizon agent kernel based on deterministic transitions:

`delta(q, s) -> (q_next, s_prime, d_next)`

- `q` is the persistent state register (`.reg_q`)
- `d` is the persistent pointer (`.reg_d`)
- `s` is the observed slice from the current pointer

This project is built from lessons learned in `gretjia/turingclaw`, with stricter modular boundaries and trap-oriented execution.

## AI Agent Quick Index (Current Cycle)

Read in this order:

1. Total design (this file): `./README.md`
2. Topology blueprint/spec: `./topology.md`
3. Handover index: `./handover/README.md`
4. Latest architect core design: `./handover/artitecture_response/core_architect_opinion_anti_oreo_v2_20260228.md`
5. Latest architect action plan: `./handover/artitecture_response/dual_llm_joint_action_plan_from_core_opinion_20260228.md`
6. Latest blocker handover: `../../handover/turingos_arch_review_handover_20260301_035950.md`

Current main issues:

- Stale report reuse after timeout can corrupt progress accounting.
- Planner may keep routing after consensus, causing thrashing before HALT.
- Worker scaling is not adaptive enough for long-horizon cost/reliability balance.
- Recovery orchestration is improved but not yet fully robust under long unattended runs.

## Topology

- [TuringOS System Topology Blueprint (v2.0 Anti-Oreo)](./topology.md)

## Core modules

- `src/kernel/engine.ts`: tick loop, trap handling, watchdog
- `src/manifold/local-manifold.ts`: physical interface for files and terminal commands
- `src/oracle/universal-oracle.ts`: strict JSON transition oracle over Kimi Code and OpenAI-compatible APIs
- `src/chronos/file-chronos.ts`: append-only journal
- `src/runtime/boot.ts`: runtime bootstrap and register persistence

## Why this differs from typical agent loops

1. Stateless model core. The model is treated as a pure transition function.
2. Persistent registers. State and pointer survive process restarts.
3. Trap-first execution. Page faults, CPU faults, and I/O faults are converted into next-cycle data.
4. Command failures are data. A non-zero shell exit does not crash the kernel; stderr is returned as `s`.
5. Watchdog protection. Repeating the same action hash 5 times triggers a watchdog trap.

## Quick start

```bash
npm install
cp .env.example .env
# fill KIMI_API_KEY in .env
npm run typecheck
npm run smoke:mock
```

Run with Kimi Code (default oracle):

```bash
KIMI_API_KEY=... npm run dev
```

Run with OpenAI oracle:

```bash
TURINGOS_ORACLE=openai OPENAI_API_KEY=... npm run dev
```

Run pilot long-horizon benchmark suite:

```bash
npm run bench:pilot
```

Run OS long-run stability benchmark (plan adherence + pointer drift):

```bash
npm run bench:os-longrun
npm run bench:os-longrun -- --repeats 10
```

Run industry-consensus AI OS matrix plan/template/score:

```bash
npm run bench:industry-matrix -- --mode plan
npm run bench:industry-matrix -- --mode template
npm run bench:industry-matrix -- --mode score --score-file benchmarks/industry-consensus/score-input.template.json
```

Runtime files are stored under `workspace/` by default:

- `workspace/.reg_q`
- `workspace/.reg_d`
- `workspace/.journal.log`
- `workspace/MAIN_TAPE.md`

## CLI options

```bash
npm run dev -- --oracle mock --max-ticks 20 --workspace ./workspace
```

Supported args:

- `--oracle kimi|openai|mock`
- `--model <model-id>`
- `--max-ticks <n>`
- `--workspace <path>`
- `--tick-delay-ms <ms>`
- `--prompt-file <path>`

## Current status

This is a development bootstrap for TuringOS v0.1. Next steps are stronger syscall abstraction, replayable test harnesses, and deterministic eval suites.

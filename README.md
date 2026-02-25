# TuringOS

TuringOS is a minimal long-horizon agent kernel based on deterministic transitions:

`delta(q, s) -> (q_next, s_prime, d_next)`

- `q` is the persistent state register (`.reg_q`)
- `d` is the persistent pointer (`.reg_d`)
- `s` is the observed slice from the current pointer

This project is built from lessons learned in `gretjia/turingclaw`, with stricter modular boundaries and trap-oriented execution.

## Core modules

- `src/kernel/engine.ts`: tick loop, trap handling, watchdog
- `src/manifold/local-manifold.ts`: physical interface for files and terminal commands
- `src/oracle/universal-oracle.ts`: strict JSON transition oracle over OpenAI
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
npm run typecheck
npm run smoke:mock
```

Run with OpenAI oracle:

```bash
OPENAI_API_KEY=... npm run dev
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

- `--oracle openai|mock`
- `--model <model-id>`
- `--max-ticks <n>`
- `--workspace <path>`
- `--tick-delay-ms <ms>`
- `--prompt-file <path>`

## Current status

This is a development bootstrap for TuringOS v0.1. Next steps are stronger syscall abstraction, replayable test harnesses, and deterministic eval suites.

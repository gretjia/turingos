# TuringOS Unified Agent Entry Point

> **This is the ONE file all AI agents must read first, regardless of IDE or CLI.**
> It is IDE-agnostic — the same rules apply to Gemini, Claude, Codex, Cursor, or any future agent.

## Quick Start

1. Read this file.
2. Read `handover/README.md` for project map and live run state.
3. Read `BIBLE.md` for the core philosophy before any architectural changes.

## Scope

**TuringOS** — A framework for achieving a long-horizon AI through system recursion, dual-brain execution, and structural complexity collapse. It is rooted in "paper, pencil, rubber, and discipline" (emulating a universal machine).

## Core Architecture

| Layer | Location | Description |
| --- | --- | --- |
| Core Philosophy | `BIBLE.md` | The fundamental theory and principles (read before architecture changes) |
| Architecture Diagram | `topology.md` | Network and system topology |
| Implementation | `src/`, `scripts/` | Source code and tooling |
| Handover & Audits | `handover/` | Current audits, plans, execution states |

## Hard Rules

1. **Progressive Disclosure**: Only read the files you need for the task. Use `grep` and file searches rather than reading massive files fully. Protect your context window.
2. **Context Limits**: Do not overload the context window with old logs or deep archives. Summarize findings into new handovers if sessions get too long.
3. **No Secrets**: Never commit passwords or keys to `.md` or code files.
4. **Agent Roles**: Be aware of the `omega-vm` (controller) vs `Mac/Windows` (workers) dynamic. See `handover/README.md` for current compute role contracts.

## AI Session Management (Best Practices)

- If you reach context limit limits, compact your memory: Summarize current findings and create a new markdown state file in `handover/audits/` or `handover/artitecture_response/`.
- Never guess the state. If you aren't sure, read the most recent dated handover files in `handover/`.
- Do not repeat entire architectural documents. Pointer linking (`See [BIBLE.md](BIBLE.md)`) is preferred.
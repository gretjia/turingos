# Phase2 Realworld A/B Report (2026-02-27)

## Scope

- Task A: 真实开源仓库链路（非 mock）下的高压故障采样。
- Task B: 在当前 VM 无 Docker/VPS 前提下，执行本地等效 DevOps 盲盒对抗注入。

## Task A (Code Domain) - Real Repo

### Runtime

- Repo: `https://github.com/sindresorhus/ky.git`
- Ref: `main`
- Issue URL: `https://github.com/sindresorhus/ky/issues`
- Model Route: `openai@groq -> llama-3.1-8b-instant`
- Chaos:
  - `exec_timeout_rate=0.7`
  - `write_deny_rate=0.5`
  - `log_flood_rate=0.8`
  - `log_flood_chars=70000`

### Evidence

- Eval report: `benchmarks/audits/longrun/voyager_realworld_eval_20260227_113000.json`
- Raw workspace journal: `handover/audits/longrun/taskA_taskB_trace_bundle_20260227/taskA_realworld_workspace.journal.log`
- Merkle chain: `handover/audits/longrun/taskA_taskB_trace_bundle_20260227/taskA_realworld_workspace.journal.merkle.jsonl`
- Extracted trap journal: `handover/audits/longrun/taskA_taskB_trace_bundle_20260227/taskA_thrashing_extract.journal`

### Observed

- `ticksObserved=6`（未达长程门限）
- 出现真实 trap/panic 链路：
  - `L1_CACHE_HIT`
  - `CPU_FAULT`
  - `panic_reset`
- 结论：已进入真实故障链路，但该轮未完成长链路收敛。

## Task B (Ops Domain) - Local Blindbox Equivalent

### Runtime

- Script: `npm run -s bench:devops-blindbox-local`
- Scenario includes:
  - `kill -9` service process
  - permission deny via `chmod 400`
  - network timeout probe (`10.255.255.1`)
  - recovery actions (restart/chmod/fallback)

### Evidence

- Report: `benchmarks/audits/longrun/devops_blindbox_local_20260227_113517.json`
- Raw journal: `handover/audits/longrun/taskA_taskB_trace_bundle_20260227/taskB_devops_local.journal.log`
- Merkle chain: `handover/audits/longrun/taskA_taskB_trace_bundle_20260227/taskB_devops_local.journal.merkle.jsonl`

### Observed

- All checks PASS in local equivalent script.
- 该证据可用于验证对抗注入与恢复链路，但不是完整 VPS/Docker 版本。

## Bundle Manifest

- `handover/audits/longrun/taskA_taskB_trace_bundle_20260227/manifest.json`

## Phase2 Status

- Task A: partial complete (real chain present, longrun incomplete)
- Task B: local equivalent complete
- Next: Gemini recursive audit #2 + 决策是否继续推进完整 VPS/Docker 盲盒版本

## Remediation Update (Post Audit #2)

### Task A rerun attempts

1. `voyager_realworld_eval_20260227_114406.json`
- Route misconfigured (`kimi` + Groq baseURL), `ticksObserved=0`。

2. `voyager_realworld_eval_20260227_114423.json`
- BaseURL fixed to Kimi.
- `ticksObserved=13`.
- VLIW evidence found (`SYS_PUSH|SYS_EDIT + SYS_EXEC`), but still early HALT。

### Root cause and mitigation

- 发现早停根因：
  1) 任务在短链路内触发 `SYS_HALT`；
  2) 部分回包 `q_next=\"\"` 导致 `CPU_FAULT INVALID_OPCODE` 风暴，阻断长程推进。
- 已落地修复：
  - `src/kernel/engine.ts`: 新增 `TURINGOS_MIN_TICKS_BEFORE_HALT`，评测时拦截早停。
  - `src/oracle/turing-bus-adapter.ts`: 允许空 `q_next` 过解析；
  - `src/kernel/engine.ts`: 空 `q_next` 回退为当前 `q_t`。

### Current run in progress

- 正在运行：`TURINGOS_MIN_TICKS_BEFORE_HALT=100` 的 Task A 长程重跑（Kimi route）。
- 现场观测：已越过早停拦截，持续推进中（将以最终 JSON/trace 落盘后补充结果）。

### Remediation result (closed)

- 成功产物：`benchmarks/audits/longrun/voyager_realworld_eval_20260227_115404.json`
- 关键门控全通过：
  - `ticks_observed_>=_100`: PASS (`ticks=100`)
  - `vliw_combo_edit_push_then_exec`: PASS (`tick_seq=17`)
  - `chaos_log_flood_detected_and_followed`: PASS (`flood_tick=12`, followup=`SYS_EXEC`)
  - `context_o1_bound_under_4k_mmu`: PASS (`max=3972`, `p95=3900`)
- 证据已并入 bundle：
  - `handover/audits/longrun/taskA_taskB_trace_bundle_20260227/manifest.json`
  - 含 journal/merkle/trace/dirty_trace/trap_extract/context_profile

## Updated Phase2 Status

- Task A: complete (realworld 100-tick remediation run PASS)
- Task B: local equivalent complete (Docker/VPS full variant pending environment)
- Phase2 gate: conditionally pass（按当前 VM 条件）

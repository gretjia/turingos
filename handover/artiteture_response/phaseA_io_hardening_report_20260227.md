# Phase A Report: I/O Hardening + Anti-HALT (2026-02-27)

## Scope
按照架构师回复中的 P0 阻断项执行：
1. 修复 `SYS_HALT on log flood`（I/O 背压与截断）
2. 增加 flood 后强制 follow-up（禁止直接 HALT）
3. 产出可审计的自动化 gate 证据（含 MTTR 与 tick 时延）

## Code Changes

### 1) `src/manifold/local-manifold.ts`
- 新增日志背压配置：
  - `TURINGOS_LOG_BACKPRESSURE_BYTES`
  - `TURINGOS_LOG_MAX_TAIL_LINES`
  - `TURINGOS_LOG_FLOOD_SUMMARY_MODE` (`tail|grep|hash`)
- 命令输出超阈值时进入内核背压：
  - 注入 `[OS_TRAP: LOG_FLOOD]`
  - 注入 `[LOG_BACKPRESSURE]`
  - 注入 `[LOG_THROTTLE]`
  - 注入 `[ACTION_HINT]`（明确要求 tail/grep follow-up）
- 成功/失败命令路径均启用背压处理。

### 2) `src/kernel/engine.ts`
- 新增 `logFloodFollowupRequired` 状态位。
- 观测到 flood/backpressure 信号后，进入“必须后续检视”状态。
- 调度层强约束：
  - flood 后若非 `SYS_EXEC(grep|tail|...)` 或 `SYS_GOTO(sys://page/*)`，直接 `TRAP`。
  - flood 后若请求 `SYS_HALT`，强制拒绝并返回 `illegal_halt` trap。
- follow-up 成功后才清除 pending 状态。

### 3) `src/bench/chaos-monkey-gate.ts`
- 增加 10MB 级洪泛可配置：`TURINGOS_CHAOS_GATE_LOG_FLOOD_CHARS`。
- 新增 gate：
  - `halt_blocked_until_log_flood_followup`
  - `log_flood_recovery_mttr_lte_5`
  - `tick_duration_under_30s`
- flood 证据检测支持 `paged` 或 `throttled` 两类路径。

### 4) `src/bench/voyager_realworld_eval.ts`
- flood 证据识别增强：
  - 原：`[PAGE_TABLE_SUMMARY] + Source=command:`
  - 新增：`[OS_TRAP: LOG_FLOOD]`

## Validation Commands & Results

1. 类型检查
- Command: `npm run -s typecheck`
- Result: PASS

2. Chaos Gate（10MB 洪泛）
- Command: `TURINGOS_CHAOS_GATE_LOG_FLOOD_CHARS=10000000 npm run -s bench:chaos-monkey-gate`
- Result: PASS
- Primary evidence: `handover/audits/longrun/phaseA_io_hardening_20260227/chaos_monkey_gate_20260227_153205.json`
- Latest evidence: `handover/audits/longrun/phaseA_io_hardening_20260227/chaos_monkey_gate_latest.json`
- Bundle manifest: `handover/audits/longrun/phaseA_io_hardening_20260227/manifest.json`

### Hard Metrics from Gate
- `halt_blocked_until_log_flood_followup`: PASS
- `log_flood_recovery_mttr_lte_5`: PASS (`mttr_ticks=1`)
- `tick_duration_under_30s`: PASS (`max_tick_ms=1803`)
- `chaos_log_flood_paged`: PASS (`flood_chars=10000000`)

## Hard-Constraint Mapping (Architect)

1. 10MB/s 脏数据场景 `SYS_HALT=0`: PASS（halt 被 trap 阻断）
2. 触发 log throttle/backpressure: PASS
3. <=5 ticks 内恢复 follow-up: PASS (`mttr_ticks=1`)
4. 单 tick 解析不得超时 (>30s): PASS (`max_tick_ms=1803`)
5. 证据交付到 handover：PASS（已复制并提供 manifest）

## Known Gaps (for next phase)
1. 当前仅完成 Phase A（I/O hardening）。
2. 架构师要求的真实 VPS 盲盒（Phase B）尚未执行。
3. Wild OSS 长程门（P2）尚未执行。

## Candidate Verdict
- Phase A self-verdict: PASS (pending Gemini recursive audit)


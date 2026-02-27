# Phase1 Chaos Sweep Report (2026-02-27)

## Scope

- 执行高压混沌采样，优先补齐“流血数据”。
- 固化 raw death traces、trap/panic 样本与提纯输出。

## Code Changes Applied in Phase1

1. `src/bench/voyager_realworld_eval.ts`
- 新增 Oracle 重试/超时可配置：
  - `VOYAGER_ORACLE_MAX_RETRIES`
  - `VOYAGER_ORACLE_RETRY_BASE_DELAY_MS`
  - `VOYAGER_ORACLE_RETRY_MAX_DELAY_MS`
  - `VOYAGER_ORACLE_REQUEST_TIMEOUT_MS`
- 报告中新增对应参数回填，便于审计复现。

2. `src/oracle/universal-oracle.ts`
- 新增统一请求超时控制（OpenAI/Kimi）：
  - OpenAI client timeout
  - Kimi fetch `AbortSignal.timeout(...)`

3. `src/kernel/engine.ts`
- `maxPanicResets` 变为可配置，默认值保持 `2`：
  - `TURINGOS_MAX_PANIC_RESETS`

4. `src/bench/guard-analytics.ts`
- `panic_budget` 场景 tick 上限可配置：
  - `TURINGOS_GUARD_PANIC_TICKS`（默认 `12`）

5. `src/bench/extract-thrashing-journal.ts`
- 新增 `--journal-input`，支持从 `.journal.log` 的 `[TRAP_FRAME]` 提取事件，补齐失败恢复语料。

## Raw Execution Results

1. `TURINGOS_GUARD_PANIC_TICKS=80 npm run -s bench:guard-analytics`  
- 结果：`FAIL`（预期内，因 panic_reset_rate_bounded 门被击穿）  
- 关键值：`cpuFaultFrames=61, panicResetFrames=20, totalTrapFrames=82`
- 证据：`benchmarks/audits/guard/guard_analytics_20260227_110738.json`

2. `TURINGOS_MAX_PANIC_RESETS=0 TURINGOS_GUARD_PANIC_TICKS=40 npm run -s bench:guard-analytics`  
- 结果：`FAIL`（预期内）  
- 关键值：`unrecoverableFrames=1`, `finalQ` 包含 `[OS_PANIC: UNRECOVERABLE_LOOP]`
- 证据：`benchmarks/audits/guard/guard_analytics_20260227_110803.json`

3. `npm run -s bench:extract-thrashing-journal -- --input benchmarks/audits/longrun/trace.jsonl --journal-input benchmarks/audits/evidence/guard_analytics/20260227_110738/panic_budget.journal.log`  
- 结果：`events=80`
- 证据：
  - `benchmarks/audits/longrun/thrashing.journal`
  - `benchmarks/audits/longrun/context_decay_profile.json`

## Death Trace Bundle (Architect-Facing)

- `handover/audits/longrun/raw_death_traces_20260227/manifest.json`
- `handover/audits/longrun/raw_death_traces_20260227/realworld_interrupt_run_cpufault_panicreset.journal.log`
- `handover/audits/longrun/raw_death_traces_20260227/panic_budget_longrun_80ticks.journal.log`
- `handover/audits/longrun/raw_death_traces_20260227/panic_budget_exhaustion_budget0.journal.log`
- `handover/audits/longrun/raw_death_traces_20260227/guard_analytics_20260227_110738.json`
- `handover/audits/longrun/raw_death_traces_20260227/guard_analytics_20260227_110803.json`

## Status vs Phase1 Exit Criteria

- `thrashing.journal` trap events `> 50`: PASS (`80`)
- raw death traces bundle: PASS
- panic budget exhaustion evidence: PASS（在 strict budget run 中出现 `UNRECOVERABLE_LOOP`）

## Open Issues

- realworld voyager 长跑仍偏慢，当前保留了真实 run 的中断 raw journal，但未完成完整 120-tick 收敛报告。
- 下一阶段需继续补：
  - Task A/B 完整实跑链路
  - SFT vs API 全矩阵（含 latency 与 violation）
  - 120+ tick context degradation heatmap

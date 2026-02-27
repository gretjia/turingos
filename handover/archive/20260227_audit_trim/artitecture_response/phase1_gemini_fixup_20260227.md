# Phase1 Gemini Fixup (2026-02-27)

## Input

- Gemini 递归审计：`handover/artitecture_response/gemini_recursive_audit_phase1_20260227.md`

## Applied Fixes

1. 动态阈值修复（P1）
- 文件：`src/bench/guard-analytics.ts`
- 变更：`panic_reset_rate_bounded` 由硬编码 `<=4` 改为按 `TURINGOS_GUARD_PANIC_TICKS` 动态计算：
  - `allowedPanicResets = max(4, ceil(panicMaxTicks / 3))`
- 复验：
  - `TURINGOS_GUARD_PANIC_TICKS=80 npm run -s bench:guard-analytics`
  - 结果：PASS
  - 证据：`benchmarks/audits/guard/guard_analytics_20260227_111122.json`

2. 失败语料提纯能力增强（P0）
- 文件：`src/bench/extract-thrashing-journal.ts`
- 变更：新增 `--journal-input`，可从 `.journal.log` 的 `[TRAP_FRAME]` 直接提取事件。
- 复验：
  - 提取命令输出 `events=80`
  - 证据：
    - `benchmarks/audits/longrun/thrashing.journal`
    - `benchmarks/audits/longrun/context_decay_profile.json`

## Pending (from Gemini)

- P0: 真实任务 A/B 的完整长链路流血样本仍需补齐（当前 realworld 样本已有中断 raw journal，但未形成完整收敛报告）。
- P0: SFT vs API 模型对标矩阵未完成（Latency / Violation / Completion）。
- P0: 120+ tick context degradation heatmap 仍未完成。

## Decision

- Phase1 fixup: done
- 下一步：进入 Phase2（realworld A/B）并触发 Gemini recursive audit #2

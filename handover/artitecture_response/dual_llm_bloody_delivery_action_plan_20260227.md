# Dual-LLM Bloody-Data Action Plan (2026-02-27)

## Mission

严格执行联合计划（5条执行主线 + 4条SFT主线），并满足架构师“下次移交必须包含深水区流血数据”的硬性交付约束。

## Hard Deliverables (Next Handover Must Include)

1. Raw Death Traces  
   真实高压任务中，调度器连续挣扎后 `panic_budget` 耗尽并崩溃的原始 `.journal.log`。
2. SFT Model vs API Model Matrix  
   至少包含基座模型 / 微调模型 / Gemini(API) 的 `Latency` 与 `Schema Violation Rate` 对比。
3. Context Degradation Profile (120+ ticks)  
   从 `../../src/chronos/file-chronos.ts` 相关快照导出的上下文衰退画像，明确后期遗忘与 eviction 生效性。

## Dual-LLM Work Mode

- Codex: 执行器（改代码、跑任务、采证、出报告）
- Gemini: 审计器（每阶段递归审计，给出 Go/No-Go 与修复项）
- Gate: 每阶段 `Implement -> Evidence -> Gemini Recursive Audit -> Fix`

## Phase Plan

### Phase 0 - Baseline Freeze

目标：
- 固化行动计划与审计约束。
- 记录当前基线状态，避免“跑偏后不可回溯”。

执行：
- 固化本文件到 `./`
- 记录基线 commit / bench latest / env profile（不含密钥）

产物：
- `./dual_llm_bloody_delivery_action_plan_20260227.md`
- `../archive/20260227_audit_trim/artitecture_response/phase0_baseline_freeze_20260227.md`

### Phase 1 - Chaos Sweep + Raw Death Data (P0)

目标：
- 生成失败恢复链路，填充 `thrashing.journal`，并获取至少一份 `panic_budget` 耗尽 death trace。

执行：
- 提高 `VOYAGER_CHAOS_*` 注入率进行批量 sweep。
- 反复运行 `bench:voyager-realworld-eval` 并提取：
  - `thrashing.journal`
  - `context_decay_profile.json`
  - 原始 `.journal.log` / `trace.jsonl` / `dirty_trace.jsonl`

验收：
- `thrashing.journal` 有效事件 `> 50`
- 至少 1 个 death run 显示 `panic_budget` 耗尽或等价不可恢复中断

产物：
- `./phase1_chaos_sweep_report_20260227.md`
- `../audits/longrun/raw_death_traces_20260227/`（原始日志包）

### Phase 2 - Realworld Task A/B (P0)

目标：
- 代码域与运维域真实任务破壁，不再依赖温室 Mock。

执行：
- Task A: 未知活跃仓库 issue 链路（复现->修复->测试->PR草案）
- Task B: 运维盲盒故障注入（kill/permission/network）

验收：
- A/B 均有失败与恢复的原始证据
- 至少一条“几十步挣扎后失败”链路完整可复盘

产物：
- `./phase2_realworld_ab_report_20260227.md`
- `../audits/longrun/taskA_taskB_trace_bundle_20260227/`

### Phase 3 - SFT/DPO Data Pipeline (P1)

目标：
- 训练数据从“成功样本主导”改为“失败恢复能力主导”。

执行：
- 构建训练配比：`Golden 40% + Failure-Recovery 40% + Rejected 20%`
- 失败恢复样本来源：`thrashing/deadlock/panic`
- DPO对：`chosen=成功纠偏`，`rejected=thrashing/违规路径`

验收：
- 生成可训练数据包（含统计与样本计数）

产物：
- `./phase3_sft_dpo_dataset_report_20260227.md`
- `../../benchmarks/audits/sft/failure_recovery_dataset_stats_20260227.json`

### Phase 4 - Model Matrix (P1)

目标：
- 输出硬指标矩阵：Base Local vs Fine-tuned Local vs API(Gemini/Kimi)。

执行：
- 运行 `guard_mcu_eval` 统一门控
- 补充端到端 latency 与 schema violation 统计

验收：
- 三模型同口径可比
- 报告中不允许只给 pass/fail，必须给原始指标

产物：
- `./phase4_model_matrix_report_20260227.md`
- `../../benchmarks/audits/sft/model_matrix_20260227.json`

### Phase 5 - 120+ Tick Degradation Heatmap (P1)

目标：
- 生成上下文衰退热力图与 eviction 证据，验证 O(1) 与后期遗忘行为。

执行：
- 导出长程 tick 轨迹并绘制 profile/heatmap
- 关联 `file-chronos` 快照与 eviction 行为

验收：
- 提供 heatmap/profile 与关键结论（是否出现后期目标遗忘）

产物：
- `./phase5_context_degradation_report_20260227.md`
- `../../benchmarks/audits/longrun/context_degradation_heatmap_latest.json`

## Gemini Recursive Audit Schedule

- Audit #1: Phase 1 完成后
- Audit #2: Phase 2 完成后
- Audit #3: Phase 3-5 完成后（终审）

每次审计产物路径：
- `./gemini_recursive_audit_phase{N}_20260227.md`

## Non-Negotiables

- 不提交“100% 绿色通过率”作为主要结论。
- 任何阶段报告必须附原始证据路径（日志、trace、json）。
- 若结果与预期冲突，优先保留失败事实，不做美化。

## Execution Status

- [x] Plan frozen
- [x] Phase 0 baseline freeze
- [x] Phase 1 chaos sweep + raw death traces
- [x] Gemini recursive audit #1
- [x] Phase 2 realworld A/B
- [x] Gemini recursive audit #2
- [x] Phase 3 SFT/DPO dataset
- [x] Phase 4 model matrix
- [x] Phase 5 context degradation heatmap
- [x] Gemini recursive audit #3
- [x] Final handover bundle

Status note (2026-02-27 12:08 UTC):
- Phase2 remediation complete: Task A reached 100 ticks and passed all eval checks (`voyager_realworld_eval_20260227_115404.json`).
- Phase4 matrix已闭环：新增 `local_qwen3_coder30b_finetuned_mlx_mac` 行，含 `Latency + Schema Violation` 硬指标。
- Phase5 已补齐 `120+`：`voyager_realworld_eval_20260227_133652.json` 达到 `ticksObserved=124`，热力图已重算。
- Gemini remediation audit (`../archive/20260227_audit_trim/artitecture_response/gemini_recursive_audit_phase2_remediation_20260227.md`): `Phase2 Gate=PASS`, overall `NO-GO`, delivery readiness `85%`.
- Phase3 dataset stats landed (`failure_recovery_dataset_stats_20260227.json`), 40/40/20 sample mix feasible at total 120 rows.
- Gemini 终审 (`gemini_recursive_audit_phase5_20260227.md`): `GO (Conditional)`，delivery readiness `100%`。

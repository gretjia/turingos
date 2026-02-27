# 双LLM执行计划（Codex × Gemini）

时间：2026-02-27
输入：`handover/artitecture_response/chief_architect_latest_feedback_20260227.md`

## 0. 协作模式

- `Codex`：执行器（实现代码、跑基准、产出证据）。
- `Gemini`：审计器（每阶段递归审计、出 Go/No-Go）。
- 节奏：每阶段 `Implement -> Gemini Recursive Audit -> 决策`。

## 1. 阶段目标映射

### P0（当日落地）

1. 固化架构意见（已完成）。
2. 建立“真实世界任务入口”基线（非 mock）：
   - A: GitHub 真实仓库 issue 修复流水线（复现->修复->测试->PR草案）。
   - B: DevOps 盲盒部署与故障注入协议（kill/权限/网络）。
3. 增加“长程上下文衰退画像”产物（120+ tick heatmap/profile）。

### P1（48小时）

1. 本地 SFT 数据面增强：加入失败恢复轨迹（thrashing/deadlock/panic）。
2. 形成本地微调 vs API 模型对比矩阵（Latency/Violation/Completion）。

## 2. 实施分解（Round-based）

### Round 1：可交付审计基础

- R1.1 产出“上下文衰退画像”脚本或报告：从 `trace.jsonl` 与 `REPLAY_TUPLE` 统计 tick->context 长度走势。
- R1.2 归档本轮执行证据到 `benchmarks/audits` + `handover/artitecture_response`。
- R1.3 Gemini 递归审计 Round 1，结论 Go/No-Go。

### Round 2：真实任务入口

- R2.1 新增代码域真实任务驱动器（Issue 修复骨架，禁 mock）。
- R2.2 新增运维域故障注入脚本（kill/permission/network）与观测断言。
- R2.3 Gemini 审计 Round 2。

### Round 3：模型策略

- R3.1 增强 SFT 数据构建脚本，纳入失败恢复链。
- R3.2 运行模型对比矩阵并形成 report。
- R3.3 Gemini 终审。

## 3. 本轮立即执行项

1. 调用 Gemini 对本计划+关键代码进行独立递归审计。
2. 按审计意见开始 Round 1 落地。

## 4. 验收标准（本轮）

- 必有文件：
  - `chief_architect_latest_feedback_20260227.md`
  - `dual_llm_execution_plan_from_latest_feedback_20260227.md`
  - `gemini_recursive_audit_from_latest_feedback_20260227.md`
- 审计结论包含：
  - 阶段风险、误判校验、修复顺序、Go/No-Go。


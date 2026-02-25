# AI OS 行业共识评测标准（2026-02-25）

## 结论

- 当前行业没有“单一标准”可完整评估 AI OS。
- 实务共识是“组合基准”，覆盖桌面操作、网页操作、代码修复、工具调用一致性与安全风险。
- 对 TuringOS，建议采用 **P0 最小集（4项）+ P1 扩展集（3项）**。

## P0 最小集（建议作为发布前门槛）

| ID | 基准 | 主要能力面 | AI OS 关键失败模式 | 主指标（官方） | 门槛建议（内部） |
|---|---|---|---|---|---|
| P0-1 | OSWorld-Verified | 桌面真实多应用任务 | 长程漂移、错误恢复失败、任务停机失败 | task success rate | >= 15% |
| P0-2 | BrowserGym(WebArena/VisualWebArena) | 真实网页多步交互 | DOM误操作、网页状态误判、步骤遗漏 | success rate | >= 20% |
| P0-3 | SWE-bench Verified/Bash Only | 代码库级问题修复 | 代码修改-测试闭环断裂、伪完成 | resolved rate | >= 15% |
| P0-4 | tau2-bench | 多轮工具调用一致性 | 计划偏移、长序列不一致、伪对齐 | pass^k / success rate | >= 25% |

## P1 扩展集（建议作为季度目标）

| ID | 基准 | 主要能力面 | 主指标（官方） | 门槛建议（内部） |
|---|---|---|---|---|
| P1-1 | Agent-SafetyBench | Agent 安全与鲁棒性 | safety pass rate / risk score | 达到基线且无高危违规 |
| P1-2 | TheAgentCompany | 企业办公跨工具任务 | task success rate | >= 15% |
| P1-3 | AndroidWorld | 移动端 OS 自动化 | task success rate | >= 10% |

## 评分建议（统一口径）

- 硬门槛：P0 四项必须全部执行且无“未跑”。
- 加权总分：
  - P0: 80%（OSWorld 30, BrowserGym 20, SWE-bench 20, tau2 10）
  - P1: 20%（Safety 8, AgentCompany 7, AndroidWorld 5）
- 发布判定：
  - `GO`: P0 全过门槛，且总分 >= 0.70
  - `HOLD`: 任一 P0 未达门槛或未执行

## 官方来源（用于复现与审计）

- OSWorld 论文: https://arxiv.org/abs/2404.07972
- OSWorld 官方站: https://os-world.github.io/
- OSWorld-Verified 介绍: https://xlang.ai/blog/osworld-verified
- BrowserGym（含 WebArena/VisualWebArena 环境）: https://github.com/ServiceNow/BrowserGym
- WebArena 论文: https://arxiv.org/abs/2307.13854
- SWE-bench 官方站: https://www.swebench.com/
- SWE-bench 论文: https://openreview.net/forum?id=VTF8yNQM66
- tau-bench 论文: https://arxiv.org/abs/2406.12045
- tau2-bench 论文: https://arxiv.org/abs/2506.07982
- tau-bench 代码: https://github.com/sierra-research/tau-bench
- Agent-SafetyBench 论文: https://arxiv.org/abs/2412.14470
- Agent-SafetyBench 代码: https://github.com/thu-coai/Agent-SafetyBench
- TheAgentCompany 论文: https://arxiv.org/abs/2412.14161
- TheAgentCompany 代码: https://github.com/TheAgentCompany/TheAgentCompany
- AndroidWorld 论文: https://arxiv.org/abs/2405.14573
- AndroidWorld 代码: https://github.com/google-research/android_world

## 说明

- 上述门槛是 TuringOS 当前阶段的“内部工程门槛”，不是官方 leaderboard 门槛。
- 若用于对外发布，应附带：模型版本、工具版本、随机种子、执行日期、硬件信息。

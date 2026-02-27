# Dual-LLM 联合行动计划（对齐架构师审计回复）

状态：Draft for Confirmation  
制定时间：2026-02-27  
执行模式：Codex(落地执行) + Gemini(递归审计)

## 1. 目标与原则

## 总目标
在不牺牲 `O(1)` 上下文纪律前提下，优先修复本次审计判定中的 P0 阻断项：
- `SYS_HALT on log flood`（I/O 背压缺失）
- 温室过拟合（local equivalent 代替真实物理环境）

## 执行原则
- `Fail-first`: 主动制造失败，再验证恢复闭环。
- `Evidence-first`: 每阶段必须附 raw log/trace，不接受“口头 pass”。
- `Dual-pass`: 每阶段必须通过 Gemini 递归审计后才可进入下一阶段。

## 2. 角色与分工（双LLM）

- Codex（Executor）
  - 改代码、跑实验、采集证据、生成阶段报告。
- Gemini（Auditor）
  - 针对阶段产物做递归审计，输出 `PASS/FAIL + blockers + fixes`。

## 交接协议
1. Codex 提交阶段产物。
2. Gemini 输出审计结论。
3. Codex 只执行 Gemini 的 blocker 修复。
4. Gemini 复审通过后进入下一阶段。

## 3. 分阶段计划（与架构师意见一一对齐）

### Phase A (P0): Kernel I/O Hardening

## 对齐审计项
- Section A Blocker #1
- Section B Critical #1
- Section C Immediate

## 代码改造
- `src/manifold/local-manifold.ts`
  - 引入日志背压与截断策略（可配置）：
    - `TURINGOS_LOG_BACKPRESSURE_BYTES`
    - `TURINGOS_LOG_MAX_TAIL_LINES`
    - `TURINGOS_LOG_FLOOD_SUMMARY_MODE` (`tail|grep|hash`)
- `src/kernel/engine.ts`
  - flood 后禁止直接 `SYS_HALT`，优先要求 `SYS_EXEC(grep/tail)` 或分页跳转。
- `src/oracle/turing-bus-adapter.ts`
  - 增加 `TRAP_LOG_FLOOD` 的结构化信号透传。

## 测试
- 注入 `10MB/s` 日志洪泛 5 轮。
- 验收门：
  - `SYS_HALT` rate = 0
  - `MTTR <= 8 ticks`
  - 无 OOM/无主循环崩溃

## 产物
- `handover/artiteture_response/phaseA_io_hardening_report_20260227.md`
- `handover/audits/longrun/raw_death_traces_20260227/*`（追加新样本）

### Phase B (P0): 真实 VPS 盲盒（替换 local equivalent）

## 对齐审计项
- Section A Blocker #2
- Section B Critical #3
- Section C Short-term

## 执行
- 在真实 VPS 运行 Task B：
  - kill process
  - chmod 000
  - 10s 网络断流
- 强制要求系统通过 bash 原生命令定位故障。

## 验收门
- `panic_budget remaining > 40%`
- `MTTR <= 8 ticks`
- 连续 3 轮无“假阳性恢复”

## 产物
- `handover/artiteture_response/phaseB_vps_blindbox_report_20260227.md`
- `handover/audits/longrun/taskB_vps_blindbox_20260227/`

### Phase C (P1): 训练数据重配与DPO抗过拟合

## 对齐审计项
- Section D 全量
- Section B High（Gate overfit）

## 数据配比
- Golden: 15%
- Failure-Recovery: 65%
- Graceful-Reject: 20%

## 质量控制
- 所有样本必须 Runtime 可回放。
- HITL 人工复核核心 recovery 样本。
- DPO 构造 chosen/rejected 对：`local inspect` vs `blind full dump`。

## 评估权重
- Recovery Success 60%
- Schema 30%
- Latency 10%

## 产物
- `handover/artiteture_response/phaseC_sft_dpo_rebalance_report_20260227.md`
- `benchmarks/audits/sft/failure_recovery_dataset_stats_latest.json`

### Phase D (P1): 北极星指标切换与路线校准

## 对齐审计项
- Section B High（North Star）
- Section E（30/90/180）

## 新主指标
- `MTTR under Chaos`（唯一北极星）

## 辅指标
- `schema_violation_rate`
- `world_op_effectiveness_rate`
- `latency_p95`

## 产物
- `handover/artiteture_response/phaseD_northstar_reset_report_20260227.md`

## 4. 我方观点、疑惑、待架构师明确事项

## 我方观点
1. 目前不能宣称“阶段性 PASS”，应视作“结构化 FAIL + 可修复”。
2. 当前系统主要优化了 Gate 通过率，不是实战泛化能力。
3. `nQ + 1A` 在执行层必须继续严格；规划层可放宽反思。

## 我方疑惑
1. `SYS_HALT` 在策略上是否应提升为“特权指令 + 强制前置验证门”（类似 two-phase commit）？
2. 对于高熵日志，优先级应该是 `tail/grep` 还是 typed summarizer page？
3. 真实 VPS 阶段应先保证生存性（MTTR）还是先追求业务成功率（task pass）？

## 希望架构师给出的关键裁决
- 若只能保留一个“执行层不可妥协约束”，你会选：
  - A) `SYS_HALT` 严格门控
  - B) `nQ + 1A` 互斥纪律
  - C) `MTTR under Chaos` 上限
  
请给出唯一选择及原因，用于我们冻结内核优先级。

## 5. 执行节奏

- T+0: 你确认本 Action Plan。
- T+1: Codex 开始 Phase A 改造并出报告。
- T+2: Gemini 递归审计 Phase A（Go/No-Go）。
- T+3~T+4: 按审计结果推进 B/C/D。


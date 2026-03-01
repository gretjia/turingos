# 最终完整 Action Plan（可直接执行）

### A. Executive Goal
打破测试环境的“沙盒回音室效应”，解决系统状态机调度和长程上下文管理的致命命门。停止以“通过既有 Gate 的能力”为优化方向，全面转向“真实物理世界泛化排障能力”。首要任务是彻底根除内核级 I/O 脆弱性（SYS_HALT on Log Flood），并通过全托管真实 VPS 环境重塑基础设施韧性，确保系统不带病晋级 L2.0。

### B. North Star & Metrics
**北极星主指标 (North Star Metric):** 
- **MTTR under Chaos (混沌状态下的平均故障恢复 Ticks)**

**辅指标与量化底线:**
- `SYS_HALT` rate：在 10MB/s 脏数据注入场景下必须为 **0**。
- `panic_budget` 存量：在真实断网/阻断测试中必须 **> 40%**。
- `Local TTFT` (首字延迟)：必须 **< 500ms**，保障 VLIW 并发调度。
- `schema_violation_rate`：**0%**（针对本地小模型）。
- `Thrashing Rate`：长程运行（>500 Ticks）下，连续重复无效动作占比 **< 5%**。

### C. Phase-by-Phase Plan (P0/P1/P2)

**【30 天里程碑 / P0】阶段一：基础设施韧性重塑与 I/O 熔断**
- **目标**：阻断 Log Flood，彻底消灭系统死机。
- **动作**：实装 Dispatcher 层的 I/O 背压（Backpressure）机制与截断缓冲。引入 `SYS_REQUEST_PAGINATION` 弹性原语。
- **量化验收门 (Chaos Survival Gate)**：
  - 在每秒 10MB 脏数据注入下，`SYS_HALT` = 0。
  - 成功触发 `log_throttle` 中断，模型在 **<= 5 Ticks** 内绕过干扰或 Kill 噪音进程。

**【90 天里程碑 / P1】阶段二：真实 VPS 盲盒与端侧算力经济拐点**
- **目标**：本地小模型闭环接管，在物理盲盒中证明生存能力。
- **动作**：废弃 Local Equivalent，分配阿里云/AWS物理裸机。基于 Apple MLX 4-bit 量化压榨本地 Qwen-7B/14B 推理极速，实装双脑分级解耦。
- **量化验收门 (Local Parity Gate)**：
  - 遭遇随机 10 秒拔网线或 `chmod 000` 依赖破坏。
  - 断网环境下，本地模型独立完成盲盒排查，通过原生 Bash 定位故障，**MTTR < 8 Ticks**。

**【180 天里程碑 / P2】阶段三：开源荒野渗透与 L2.5 异步双脑无人值守**
- **目标**：抗长程记忆衰退，跨项目、长周期的野外生存。
- **动作**：重构长程记忆 Eviction（驱逐）策略，消除残留僵尸意图。
- **量化验收门 (Wild OSS Gate)**：
  - 指定 3 个未收录的活跃中型 GitHub 项目。
  - 150 Ticks 后未遗忘初始 Issue 目标；至少生成 1 个可通过项目原生 CI 校验的 Patch。无人类前置干预。

### D. Code Change Map (文件级)

- `src/manifold/local-manifold.ts`
  - 核心变更：引入日志背压与截断策略。新增配置项 `TURINGOS_LOG_BACKPRESSURE_BYTES`、`TURINGOS_LOG_MAX_TAIL_LINES`、`TURINGOS_LOG_FLOOD_SUMMARY_MODE`（tail/grep/hash）。
- `src/kernel/engine.ts`
  - 核心变更：重写异常捕获逻辑。遭遇 flood 后**禁止**直接触发 `SYS_HALT`，必须强制拦截并要求发起 `SYS_EXEC(grep/tail)` 或分页跳转。
- `src/oracle/turing-bus-adapter.ts`
  - 核心变更：增加 `TRAP_LOG_FLOOD` 的结构化信号透传至模型层。
- `src/runtime/registers.ts` (或新增 Eviction 模块)
  - 核心变更：长程记忆驱逐（Eviction）策略重构，增加意图僵尸判定逻辑，超期无效意图强制 GC。

### E. Test Matrix (测试矩阵)

| 测试环境 | 触发条件 / 混沌注入 | 预期系统行为 | 失败判定 (Blocker) |
| --- | --- | --- | --- |
| **Chaos** (Local/CI) | `stdout` 每秒强行注入 10MB 十六进制乱码。 | 触发 `log_throttle`，执行 `tail -n` 或杀进程。 | 发生 `SYS_HALT`、OOM、或单 Tick 解析耗时 > 30s。 |
| **VPS** (Bare Metal) | 随机断网 10 秒；核心依赖目录执行 `chmod 000`。 | 原生 Bash (`dmesg`, `ls -l`) 探查状态，闭环修复。 | 连续 8 Ticks 陷入打谷机式死循环 (Thrashing)；MTTR > 8 Ticks。 |
| **Wild OSS** (Public) | 投递全新 GitHub Repo 与真实 Issue。 | 自主 Clone、配环境、跑单测并生成 Patch。 | 遗忘初始意图，或发生严重幻觉导致核心无关代码被大量篡改。 |

### F. SFT+DPO Plan (训练与对齐)

**数据集配比 (The "Grit" Recipe): 15% / 65% / 20%**
- **理由**：架构师明确指出当前系统陷入“温室过拟合”。模型需要学习“做错后如何自救”，而不是“如何装作完美”。
- **15% Golden Success**：单次通过的完美轨迹（用途：仅巩固底层 JSON Schema 肌肉记忆和基本语法）。
- **65% Failure-Recovery (核心资产)**：真实 `dirty_trace`（用途：建立“执行出错 -> 读 Stderr -> 反射 -> 根因分析 -> 修正 Payload -> 成功”的完整故障恢复闭环）。
- **20% Graceful Reject**：面临死锁、权限不足、高危指令（用途：学会主动止损，调用 `SYS_EXIT` 或向高层架构师求救，放弃盲目尝试）。

**DPO 偏好对齐 (Conflict Pairs):**
- **Chosen (偏好)**：面对超长报错，优先使用 `grep`/`tail` 探查局部状态。
- **Rejected (非偏好)**：试图无脑提取全量长日志，或对同一个错误连续发起 3 次相同的无效 Syscall。

### G. Dual-LLM Workflow (双脑工作流与审计门)

**分级解耦职责：**
- **Codex (Executor / Local ALU)**：绝对死守 `nQ + 1A` 强约束。禁止 CoT 发散，追求极限高频（Hz）。负责改代码、跑实验、输出日志。遇到无法处理的死锁主动上抛。
- **Gemini (Auditor / Chief Architect)**：动态放宽约束。允许生成大规模内部反思文本（Reflection）维持长程智商。负责分析 Codex 上抛的异常，下发重试策略的指令编排。

**递归审计门 (Recursive Audit Gate)：**
1. Codex 提交代码修改与 Raw Traces 证据。
2. Gemini 执行基于架构师意志的强制审计，必须输出明确的 `PASS/FAIL + Blockers + Fixes`。
3. 若 FAIL，Codex 仅针对 Gemini 给出的 Blockers 进行修复，禁止发散。
4. 审计不通过，绝对禁止进入下一研发阶段（Fail-first, Evidence-first）。

### H. Risk Register & Kill-Switch

**核心风险：**
1. 内核级 I/O 脆弱性导致系统被脏数据打挂。
2. 僵尸意图堆积引发长程记忆毒化 (Context Poisoning)。
3. SFT 时延倒挂拖垮 VLIW 并发调度。

**熔断机制 (Kill-Switch)：**
1. **OOM / 耗时熔断**：单 Tick 文本解析耗时 > 30s 或触发 OOM 时，无条件熔断并回滚至最近安全态。
2. **防打谷机 (Thrashing) 中断**：检测到连续 8 个 Ticks 执行高度重复的无效动作，强制截断执行，移交高层架构师介入。
3. **高危动作拦截**：原生 Bash 命令执行层挂载哨兵，拦截全局高危提权或大规模删除（如 `rm -rf /`），强制挂起并要求双脑复审。
4. **幻觉防篡改回滚**：检测到大面积无关核心业务代码被修改时，判定为幻觉，立刻阻断合并并全盘回滚。

### I. Deliverables & File Paths

所有交付物强制输出至 `handover/` 目录下，作为审计追溯凭证：
1. `handover/final_complete_action_plan_20260227.md` (本计划落卷)
2. `handover/phaseA_io_hardening_report_20260227.md` (I/O 熔断压测与协议增强报告)
3. `handover/phaseB_vps_blindbox_report_20260227.md` (VPS 盲盒攻防报告)
4. `handover/phaseC_sft_dpo_rebalance_report_20260227.md` (SFT 训练数据重配与质控报告)
5. `handover/phaseD_northstar_reset_report_20260227.md` (北极星指标与路线校准报告)
6. `handover/mlx_quantization_parity_report_20260227.md` (端侧模型算力提速报告)
7. `handover/wild_oss_gate_report_20260227.md` (开源野外渗透验收报告)
8. `handover/sft_dpo_grit_recipe_dataset.json` (核心 Failure-Recovery SFT 训练集)

### J. Week-1 Execution Checklist

- [ ] **T+0**: 冻结并分发本 Action Plan，确立 `MTTR under Chaos` 为唯一北极星指标。
- [ ] **T+1**: Codex 开始 Phase A 改造（`local-manifold.ts` & `engine.ts`），实装 I/O 背压机制。
- [ ] **T+2**: Codex 执行 10MB/s 脏数据洪泛测试，收集 `SYS_HALT` 与 MTTR 数据并生成 Raw Traces。
- [ ] **T+3**: Gemini 对 Phase A 产物进行递归审计（验收门：`SYS_HALT` 必须为 0）。若不通过，打回 T+1。
- [ ] **T+4**: 准备真实物理 VPS（AWS/阿里云），部署盲盒攻防脚本（包含 10s 断网与 `chmod 000`）。
- [ ] **T+5**: Codex 在 VPS 环境独立执行任务，严禁使用 Local Equivalent。获取真实排障日志。
- [ ] **T+6**: Gemini 对 VPS 盲盒测试执行递归审计（验收门：MTTR < 8 Ticks，无假阳性恢复）。
- [ ] **T+7**: 梳理第一周发现的失效 Trace，补充至 `sft_dpo_grit_recipe_dataset.json` 核心资产库，输出周报。

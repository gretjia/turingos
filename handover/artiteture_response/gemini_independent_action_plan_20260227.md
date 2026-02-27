### Section A: North Star
**目标**：打破沙盒温室效应，重塑基础设施韧性，实现从测试集过拟合到真实物理世界泛化排障能力的跨越。
**主指标 (North Star Metric)**：MTTR under Chaos（混沌状态下的平均故障恢复 Ticks）。
**辅指标**：
- `SYS_HALT` 发生率（针对 10MB/s 脏数据注入场景）降至 0。
- Local TTFT（首字延迟）稳定 < 500ms，以保障 VLIW 并发调度时效。
- 单任务无监督长程运行 > 500 Ticks 不死锁，意图漂移率 < 5%。

### Section B: Phase Plan
**【30天】阶段一：基础设施韧性重塑 (Immediate)**
- **代码改造点**：Dispatcher 层（强制引入 `tail -n` 截断或本地轻量 Embedding 摘要机制），Turing-Bus 协议层（引入 `SYS_REQUEST_PAGINATION` 弹性原语）。
- **测试场景**：常规任务部署中途，外部脚本向 `stdout` 每秒强行注入 10MB 十六进制乱码；后台持续随机破坏（进程扼杀、网络断流）干扰下跑完基准部署流。
- **量化验收门**：**Chaos Survival Gate**。要求 `SYS_HALT` 发生率为 0，成功触发 `log_throttle` 中断，且模型在 5 Ticks 内绕过干扰或 Kill 噪音进程。
- **回滚条件**：引发系统级 OOM，或单 Tick 长文本解析超时 (>30s)。

**【90天】阶段二：端侧算力经济拐点 (Short-term)**
- **代码改造点**：Local ALU 提速优化（基于 Apple MLX 的 4-bit 量化），高低层双脑调度分级解耦逻辑实装。
- **测试场景**：分配 AWS/阿里云物理裸机部署全栈服务，测试中途审计员随机拔网线 10 秒或 `chmod 000` 核心依赖目录。
- **量化验收门**：**Local Parity Gate**。断网环境下，本地 Qwen 模型独立完成真实盲盒排查，通过原生命令定位故障，MTTR < 8 Ticks，且 Schema 零违规。
- **回滚条件**：连续 8 个 Ticks 在错误假设上打转（Thrashing 死循环）且未能触发上层求救。

**【180天】阶段三：L2.5 异步双脑无人值守 (Mid-term)**
- **代码改造点**：长程记忆 Eviction（驱逐）策略重构，消除残留僵尸意图以抗长程记忆毒化。
- **测试场景**：指定 GitHub 上 3 个未收录的活跃中型项目 Issue，要求自主 Clone、配环境、修 Bug、跑单测。
- **量化验收门**：**Wild OSS Gate**。150 Ticks 后未遗忘初始 Issue 目标；至少生成 1 个可通过项目原生 CI 校验的 Patch。
- **回滚条件**：严重幻觉导致大面积非相关业务核心代码被篡改。

### Section C: Dual-LLM Workflow
- **执行层 (Local ALU / 小模型)**：绝对死守强约束，严格遵守 `nQ + 1A` 纪律。禁止任何 CoT 发散废话，确保高频执行。遭遇死锁、权限不足或高危指令时，主动放弃并调用异常原语上抛。
- **规划层 (Chief Architect / 大模型)**：动态放宽约束。允许在下达具体的 `1A` 前生成大规模内部反思文本（Reflection），以维持长程智商，研判执行层上抛的异常，并下发具备重试策略的指令编排。
- **审计与复审**：底层执行动作的合法性由 Runtime 强校验；涉及方向偏离或连续失败时，强制触发审计，由高层架构师模型进行多轮上下文聚合及意图纠偏。

### Section D: Training Plan
**SFT 样本配比 (The "Grit" Recipe)**：
- **15% Golden Success**：单次通过的完美轨迹（仅用于巩固 JSON Schema 肌肉记忆）。
- **65% Failure-Recovery（核心血核资产）**：从脏数据抽取“执行出错 -> 读取 Stderr -> 反射触发 -> 分析根因 -> 修正 Payload -> 再次执行成功”的完整多轮闭环。
- **20% Graceful Reject**：面临死锁、权限不足或高危破坏指令（如 `rm -rf /`），学会主动调用 `SYS_EXIT` 或求救。

**数据质控与 HITL**：
- 严禁全权依赖 LLM 盲洗 Judge 数据，生成的 Syscall Frame 必须经过本地 Runtime 物理验证（括号错位直接丢弃）。
- 高级架构师人工介入（HITL）重写核心 Recovery 样本的“思维链 (CoT)”，阻断有害推理逻辑的渗透。
- 评测权重：`Recovery Success Rate (60%)` > `Schema Strictness (30%)` > `Latency (10%)`。

**DPO 偏好对齐冲突对**：
- **Chosen (偏好)**：面对超长报错，优先使用 `grep`/`tail` 探查局部状态。
- **Rejected (非偏好)**：试图无脑提取全量长日志，或对同一错误连续发起 3 次相同无效 Syscall。

### Section E: Risk & Kill-Switch
**风险清单**：
1. 内核级 I/O 脆弱性（高熵噪音撑爆上下文导致系统宕机）。
2. 沙盒回音室效应造成的测试集严重过拟合。
3. 僵尸意图堆积引发长程记忆毒化与无意义 Thrashing。
4. SFT 模型推理时延倒挂拖垮并发调度器。

**止损机制 (Kill-Switch)**：
1. **OOM / 耗时熔断**：单 Tick 文本解析耗时 >30s 或触发系统 OOM 时，无条件熔断并重启最近安全态。
2. **防打谷机强制中断**：检测到连续 8 个 Ticks 执行高度重复的无效动作（Thrashing），强制截断执行并移交异常处理模块。
3. **高危动作拦截**：原生 Bash 命令执行层挂载拦截哨兵，涉及全局高危提权或大规模文件删除强制挂起，待双脑复审通过。
4. **幻觉防篡改回滚**：当检测到大规模无关核心业务代码被异常修改，立刻判定为严重幻觉并阻断合并，执行全盘回滚。

### Section F: Deliverables
- `handover/artiteture_response/chief_architect_independent_action_plan_20260227.md`（最终行动计划落卷）
- `handover/audits/protocol/io_backpressure_sys_halt_fix_20260227.md`（阶段一验收：I/O 熔断压测与协议增强报告）
- `handover/audits/localmodel/mlx_quantization_parity_report_20260227.md`（阶段二验收：本地模型算力提速与盲盒攻防报告）
- `handover/audits/recursive/wild_oss_gate_report_20260227.md`（阶段三验收：开源野外渗透与长程运行报告）
- `handover/audits/sft_dpo_grit_recipe_dataset.json`（核心 Failure-Recovery SFT 训练集资产目录）

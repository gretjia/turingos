基于对当前基线测试结果（0% 通过率，高 `PAGE_FAULT` 均值 17.33，计划执行偏离，以及长链条任务中的 `WATCHDOG_NMI` 触发）和现有核心代码的深入分析，这里为您提供本轮改进的架构可执行设计。

按照要求，我将改动收敛为 **3个最小高收益改动**，全面覆盖 `thought -> json 协议`、`L1 trace cache`、`MMU guard` 以及 `call stack syscall`，并按照优先级（P0/P1/P2）排序。

---

### 1. 原生支持 Thought -> JSON 协议 (优先级: P0)

**问题 (Problem)**: 
基线显示完成度为 0，计划偏离度高（plan_avg: 0.33）。模型经常在未经深思熟虑的情况下直接输出动作，或者为了进行 Chain-of-Thought (CoT) 推理而破坏了严格的 JSON 结构，导致 `CPU_FAULT` (解析失败) 或产生无意义的短视行为。

**原因 (Cause)**: 
在 `src/kernel/types.ts` 中，`Transition` 接口 (`q_next`, `s_prime`, `d_next`) 过于机械化。目前的架构迫使大语言模型直接输出状态和动作，没有为其提供合法的“思考暂存区”，压抑了模型的规划能力。

**改动点 (Change - thought -> json protocol)**:
1. **`src/kernel/types.ts`**: 扩展 `Transition` 接口，增加 `thought: string` 字段（放在首位）。
2. **`src/kernel/engine.ts`**: 在 `chronos.engrave` 中记录 `thought`，并考虑在发生 Trap 时将上一轮的 `thought` 混入恢复上下文中。这允许模型在严格的 JSON 约束内“大声思考”，在输出 `d_next` (动作) 前完成内部逻辑推演。

**验证方式 (Validation)**: 
执行 `bench:os-longrun`。抓取生成的 JSON 产物，确认 `thought` 字段被合理填充。计划遵循度 (`plan_avg`) 应当显著上升，因为模型在每一步都能重申当前步骤目标。

**回滚方式 (Rollback)**: 
从 `Transition` 接口移除 `thought` 字段，撤销 `engine.ts` 中的相关日志记录。

---

### 2. 引入 L1 Trace Cache 与上下文感知 MMU Guard (优先级: P1)

**问题 (Problem)**: 
系统被大量的 `PAGE_FAULT` 淹没（平均 17.33 次/Run），且模型容易在错误路径上死循环。虽然已有 5-tick 的 Watchdog 机制，但拦截过晚。

**原因 (Cause)**: 
- 目前的 MMU (`local-manifold.ts` 中的 `observe`) 过于僵化，文件不存在时仅抛出粗糙的错误，未提供空间感知能力（模型不知道自己在哪里）。
- 目前的“L1 缓存”（`engine.ts` 中的 `lastObservedPointer`）仅能在**命令执行成功且输出未变**时触发软拦截，对“重复读取失败路径”或“重复生成错误指令”的循环完全无能为力。

**改动点 (Change - MMU guard & L1 trace cache)**:
1. **MMU Guard (`src/manifold/local-manifold.ts`)**: 增强文件系统的 Page Fault 拦截。当 `observe()` 遇到文件不存在时，自动解析其父目录路径；如果父目录存在，执行轻量级的 `fs.readdirSync`，将目录内的真实文件列表附在 `PAGE_FAULT` Trap 消息中返回给模型，实现上下文纠偏。
2. **L1 Trace Cache (`src/kernel/engine.ts`)**: 将单变量 `lastObservedPointer` 升级为深度为 3 的 `L1TraceCache` 环形队列，记录最近 3 次的 `[d_t, s_prime]` 摘要。如果发现引擎在 3 步内发出了完全相同的“指针+干扰内容”（无论成功失败），立即触发 `[OS_TRAP: L1_CACHE_HIT]` 软中断，强制模型换路，而非等待 5 步的底层死锁 Watchdog。

**验证方式 (Validation)**: 
监控 `bench:os-longrun` 结果，`PAGE_FAULT` 均值应大幅下降（预期降至 5 以下），且 `watchdogAvg` 应接近于 0，因为 L1 Cache 在模型陷入死循环前就已将其打断。

**回滚方式 (Rollback)**: 
移除 `local-manifold.ts` 中的目录嗅探逻辑，将 `engine.ts` 恢复为仅比对上一次 pointer 的原生逻辑。

---

### 3. 实现 Call Stack Syscall 通道 (优先级: P2)

**问题 (Problem)**: 
在 "Long Checklist Stability" 与 "Fault Recovery Resume" 场景中均全部失败（通过率为 0）。现有的 Watchdog 中断建议模型 "Pop current task"，但系统在物理层面上根本不存在让模型 Pop 的数据结构。

**原因 (Cause)**: 
状态寄存器 `q_next` 只是一个扁平的字符串。当模型需要挂起当前任务去处理中断（例如修复缺少的依赖文件）时，它在扁平字符串中极易丢失上下文，导致“栈溢出”或彻底遗忘原计划。

**改动点 (Change - call stack syscall)**:
1. **`src/manifold/local-manifold.ts`**: 新增一个原生的内核通信通道 `sys://callstack`。
   - `observe('sys://callstack')`: 格式化并返回当前任务栈的层级列表。
   - `interfere('sys://callstack', payload)`: 根据 payload 的内容执行栈操作。如果内容为 `PUSH: <任务描述>` 则压栈；如果为 `POP` 则弹栈。
2. **`src/kernel/engine.ts`**: 为了减少模型主动查询栈的开销，可在每次 `tick()` 组装 `s_t` 数据总线时，将当前的**栈顶任务** (Top Frame) 作为环境变量静默注入到数据流顶部。

**验证方式 (Validation)**: 
执行基线测试。通过分析命令执行日志 (`04_test_commands.txt` / JSON轨迹)，能明确观察到模型向 `d_next: "sys://callstack"` 写入 `PUSH` 和 `POP` 指令。"Fault Recovery Resume" 场景的完成率应破零。

**回滚方式 (Rollback)**: 
从 `local-manifold.ts` 的 `observeSystemChannel` 和 `interfere` 路由中剔除 `sys://callstack` 分支，恢复原状。

---

### 总结 & 实施建议

以上三个最小化设计严格对齐了您的架构规范约束，无需对核心内核大动干戈即可接入。
建议在 `01_gemini_design.md` 中采纳此方案，并按照 **P0 -> P1 -> P2** 的顺序在此循环内执行代码修改：
1. 先打通 **Thought -> JSON** 让模型恢复智力。
2. 再加上 **L1 & MMU** 让系统具备防撞和自愈护栏。
3. 最后注入 **Call Stack** 赋予其处理复杂长链条任务的记忆结构。

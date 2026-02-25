```markdown
# TuringOS Cycle 02 架构设计报告 (External Consultant)

## 核心设计摘要
**目标**：提升 `plan_avg` 与 `completion_avg`，同时保持 Cycle 01 取得的稳定性（零 watchdog 触发，极低的 page_fault）。
**约束**：最多 3 个代码改动。优先保证进度推进不倒退。

---

## 1. 核心问题与改动设计

### [P0] 问题 1：进度追踪丢失与格式错乱导致计划执行停滞
* **问题描述**：基线指标中 `plan_avg` 仅为 0.2937，`completion_avg` 仅为 0.0333。模型在执行过程中（特别是出错恢复后）经常丢失上下文，不知道当前的确切进度。同时在向 `sys://append/plan/progress.log` 写入时，常因格式错误（未遵循严格的 `DONE: <step>`）或顺序错误，频繁触发 `[OS_TRAP: PLAN_CONTRACT]`，导致浪费大量时钟周期。
* **原因**：
  1. `FileExecutionContract` 目前仅作为“后置校验器”（检查是否违规），未能向“前置上下文”（Tick Context）暴露 **当前迫切需要的下一个动作**（`NEXT_REQUIRED_DONE`）。
  2. `sys://append/` 通道对写入内容的容错率极低。缺乏在引擎层的格式前置规范化（Normalization）与预检。
* **改动点 1 (src/runtime/file-execution-contract.ts - 暴露状态)**:
  - 在 `FileExecutionContract` 类中新增 `public async getNextRequiredStep(): Promise<string | null>` 方法。
  - **逻辑**：对比 `orderedSteps()` 数组与已解析的 `readDoneSteps()` 数组，返回尚未完成的第一个步骤的字符串（即 `ordered[done.steps.length]`）。
* **改动点 2 (src/kernel/engine.ts - 注入 Tick 上下文)**:
  - 在 `tick()` 方法的 `1.5) Validate progress contract` 阶段，调用上述新方法获取 `nextStep`。
  - **逻辑**：在 `s_t`（观察切片）中显式追加全局指引：`\n[NEXT_REQUIRED_DONE] ${nextStep}`。无论当前是否触发了 TRAP，都向模型广播这一高价值信号。
* **改动点 3 (src/kernel/engine.ts - I/O 写前守卫与规范化)**:
  - 在 `tick()` 方法的 `4) Interfere with physical world` 阶段，针对目标为 `progress.log` 的 `isAppendChannel` 操作进行拦截。
  - **规范化**：如果 `s_prime`（Payload）未包含 `DONE:` 前缀，但内容匹配 `nextStep`，自动在写入前为其补全 `DONE: ` 前缀，消除语法微错引发的陷阱。
  - **阻断**：如果规范化后的写入内容与 `NEXT_REQUIRED_DONE` 期望的步骤不匹配，拦截实际的物理 I/O，并直接返回 `[OS_TRAP: IO_FAULT] Progress strictly requires: DONE:${nextStep}`。
* **验证方式**：
  - 重新运行 `bench:os-longrun`。
  - 分析 `04_test_commands.txt` 或测试日志，预期 `plan_avg` 提升至 0.5 以上。
  - 检查生成的 `progress.log` 记录，确认不再出现乱序或无前缀的脏数据。
* **回滚方式**：
  - 撤销 `engine.ts` 中的拦截判断以及 `NEXT_REQUIRED_DONE` 字符串注入，恢复完全依赖 `FileExecutionContract.checkProgress()` 的后置被动报错模式。

---

## 2. 覆盖架构四项关键机制的协同分析

本次 Cycle 02 设计与 TuringOS 核心机制的正向协同效应如下：

1. **Call Stack Syscall (调用栈机制)**:
   - **映射**：引擎通过 `sys://callstack` 配合 `PUSH/POP` 指令管理任务栈。
   - **协同增益**：以往由于不知道确切的进度，模型会 PUSH 错误的子任务。在上下文常驻 `[NEXT_REQUIRED_DONE]` 后，模型的推断有了唯一的“北极星”锚点，能够精准地将该步骤作为 `stack_payload` 执行 `PUSH`，消除任务栈与物理契约之间的漂移。

2. **MMU Guard (内存截断守卫)**:
   - **映射**：`LocalManifold.guardSlice` 会截断超长输出并触发 `[OS_TRAP: MMU_TRUNCATED]`。
   - **协同增益**：模型在迷失当前计划时，往往企图通过 `cat` 或全局 `grep` 探索状态，频繁碰触 MMU 红线。高频广播 `NEXT_REQUIRED_DONE` 将极大收敛模型的动作空间，减少试探性读取，从而间接降低引发大块数据截断的几率（维持 page_fault 低水位）。

3. **L1 Trace Cache (短视距动作缓存)**:
   - **映射**：通过监控短时间内的 `d_next` 与 `s_prime`，防止连续重复动作引发死循环（`[OS_TRAP: L1_CACHE_HIT]`）。
   - **协同增益**：针对 `progress.log` 的写前规范化（改动点3）直接阻断了“因少写一个冒号被 Contract 拒绝 -> 换种写法再次被拒绝 -> 触发 L1 Cache Hit 甚至 Watchdog” 的经典死循环。将意图正确的请求自动修正为合法语义，保护 L1 Cache 空间。

4. **Thought -> JSON 协议**:
   - **映射**：Oracle 依赖模型的 `thought` 推理后强制输出标准 JSON `Transition`。
   - **协同增益**：硬核注入的 `[NEXT_REQUIRED_DONE]` 能直接干预模型的 CoT（思维链）过程。模型在生成 `thought` 时会优先注意到系统级的要求，从而在最终的 JSON `s_prime`（输出载荷）中一发命中目标步骤，提升 JSON 生成的动作有效率。

---

## 3. 执行优先级与风险评估

| 阶段 / 改动 | 风险级别 | 说明 | 优先级 |
| :--- | :---: | :--- | :---: |
| **Change 1**: `FileExecutionContract` 新增 `getNextRequiredStep` | **P2 (低)** | 纯只读方法，仅作状态暴露，无任何副作用。 | 1 |
| **Change 2**: `engine.ts` 注入上下文 | **P1 (中)** | 更改了提示词上下文结构。由于置于 `s_t` 独立区域，不破坏现有的报错正则，但可能引起部分模型权重的微小漂移。 | 2 |
| **Change 3**: `engine.ts` 写前规整与守卫 | **P0 (高)** | 直接介入并修改了模型的物理 I/O 动作。风险在于 Normalize 过于严格或宽泛导致死锁。要求实现时必须对 `isAppendChannel` 以及路径匹配（`plan/progress.log`）做绝对安全的类型限定。 | 3 |

**总结**：本次设计方案在严格满足 Scope 的前提下，通过“**状态显式暴露 (Context)**”与“**写时自动规整 (Write-Guard)**”的双重结合，解决了智能体在长上下文中迷失进度的问题。有望在不破坏 Cycle 01 稳定性基座的基础上，显著拉升 `plan_avg` 与 `completion_avg`。
```

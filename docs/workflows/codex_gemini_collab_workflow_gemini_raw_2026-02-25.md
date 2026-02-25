# TuringOS 冯·诺依曼内核升维：Codex × Gemini 双代理协同演化工作流

基于对 `benchmarks/audits/` 崩溃样本的深度物理学与信息论“尸检”，为根治大语言模型在长周期操作系统环境下的**马尔可夫热寂 (Markovian Ego-Death)**、**上下文超新星 (Contextual Supernova)** 与 **西西弗斯拓扑死锁 (A-B-A-B Attractor)**，特设计此 Codex 与 Gemini 3.1 Pro Preview 双代理协同长程演化方案。

---

## 1. 目标与成功判据 (Goals & Success Criteria)

**核心目标**：将大模型从“必须死记硬背的物理内存 (RAM)”解放为“纯粹的只读逻辑运算单元 (ALU)”，依赖 OS 托管的调用栈、MMU 截断机制和轨迹缓存，实现长程任务的绝对收敛。

**量化成功判据 (Go/No-Go Metrics)**：
*   **长程无漂移率 (Zero-Drift)**：在 1000+ Ticks 的 `os-longrun` 测试中，ROM 级 `ultimate_mission` 记忆完好率 100%，Call Stack (RAM) 最终能清空并抛出 `HALT` 指令，目标偏移率 0%。
*   **MMU 防御率**：面对 >10,000 tokens 的野蛮输出（如读取完整 `package-lock.json` 或 `npm` 级联报错），系统 OOM 或 LLM 崩溃/幻觉率降至 0%，模型主动调用 `grep` / `head` 等分页过滤命令的触发率 > 95%。
*   **死锁逃逸率**：连续 3 次执行相同错误动作 (A-B-A-B) 的死锁场景，依赖 L1 Trace Cache 的死锁打断并主动 `PUSH` 新排查任务的成功率达 100%。

---

## 2. 双代理分工与责任边界 (Roles & Boundaries)

| 代理实体 | 角色定位 | 核心职责与责任边界 |
| :--- | :--- | :--- |
| **Codex** | **架构师与 OS 内核开发者** (The Architect) | 负责 `src/kernel/`, `src/runtime/` 的物理实现。编写严格的 TypeScript 接口，实现 OS 托管的 Call Stack、MMU 截断屏障。**绝对不负责生成业务逻辑，只负责建立物理定律。** |
| **Gemini 3.1 Pro** | **内核引擎与独立审计员** (The ALU / Auditor) | **作为 ALU**：在 `os-longrun` 中扮演纯粹的 Syscall 发射器，遵循 `<thought>` -> `JSON` 协议。**作为 Auditor**：周期性审查 Codex 的代码和机器运行日志，判断是否符合“冯·诺依曼”第一性原理。 |

---

## 3. 工件协议 (Artifact Protocols)

所有演化步骤必须产出以下标准化受控工件，强制证据化：
*   **物理层接口 (Kernel API)**：`src/kernel/types.ts` (必须包含 `HardwareRegisters`, `Syscall`)
*   **运行时核心 (Runtime Core)**：`src/runtime/registers.ts` (必须实现物理托管的 Array-based Call Stack)
*   **内存管理单元 (MMU Guard)**：`src/manifold/local-manifold.ts` (必须包含 `[OS_TRAP: STDOUT TRUNCATED]` 逻辑)
*   **审计报告 (Audit Report)**：`benchmarks/audits/INDEPENDENT_EVIDENCE_SUMMARY_[DATE].json`
    *   *要求*：必须包含对应代码版本的 git diff hash、运行 Tick 数、MMU 触发次数、Call Stack 深度峰值。

---

## 4 & 5. 12步闭环工作流 (12-Step Closed-Loop Process)

| 阶段 | 步骤 | 代理 | 输入 (Input) -> 输出 (Output) | 通过标准 (Gate) & 失败回滚 (Rollback) |
| :--- | :--- | :--- | :--- | :--- |
| **基础** | 1. 发现 | Gemini | 失败日志 -> 架构级尸检报告 | 明确指出哪种失效（热寂/爆炸/死锁）。 |
| | 2. 假设 | Gemini | 尸检报告 -> 冯·诺依曼映射方案 | 必须定义对应的 OS 基石 (如 Call Stack 替代 Prompt 记忆)。 |
| | 3. 方案 | Codex | 映射方案 -> 接口定义 (TS) | TS 类型通过严格校验，禁用自然语言状态维护。 |
| **实施** | 4. 隔离搭建 | Codex | 接口定义 -> 测试桩环境 | 编译通过，无副作用。 |
| | 5. 核心基建 | Codex | `types.ts` -> MMU & Stack 实现 | MMU 字符截断生效；Stack 支持 PUSH/POP。 |
| | 6. 引擎重构 | Codex | 基建 -> `engine.ts` 接入 | L1 Trace 成功注入 Context，Syscall 闭环。 |
| **验证** | 7. 单步单元测试 | Codex | `engine.ts` -> 单元测试结果 | Syscall 解析正确，`<thought>` 解析分离成功。回滚：重写 Regex。 |
| | 8. 短周期压测 | Gemini | 简单任务 -> 50 Ticks 日志 | 任务收敛，无死锁。回滚：调整 `turing_prompt.sh`。 |
| | 9. 长周期模拟 | Gemini | 复杂任务 -> 1000 Ticks 日志 | 目标不漂移，遭遇长文本成功触发 MMU Trap。回滚：强化 MMU。 |
| **审计** | 10. 第一性原理审计| Gemini | 全量代码+日志 -> 架构合规报告 | 确认无 LLM 状态驻留。违反则打回重构 `types.ts`。 |
| | 11. 反例攻击测试 | Gemini | 注入毒性/乱码 -> 韧性报告 | 面对 OOM 攻击不崩溃；面对 A-B-A 攻击能逃逸。 |
| | 12. 基线回归 | 双代理 | 审计通过的 PR -> 合并入主干 | 更新 `BIBLE.md` 和 `README.md`。 |

---

## 6. 审计机制 (Audit Mechanisms)

1.  **第一性原理审计 (First Principles Audit)**：
    *   *准则*：大模型不允许作为物理存储器。
    *   *审查*：扫描 Prompt 生成逻辑，如果发现将“上一步 LLM 自身输出的全量任务列表”直接喂给“下一步的 LLM”，直接判为 **No-Go**。必须验证 Prompt 中注入的是 OS 维护的只读 `Call Stack` 数组。
2.  **BIBLE 对齐审计 (BIBLE Alignment)**：
    *   *审查*：所有 `src/kernel/` 变更必须且只能增加对 LLM 的**物理约束**（如 MMU），绝不能增加“启发式引导词”（如告诉模型“你应该更聪明”）。
3.  **反例攻击审计 (Counter-example Attack)**：
    *   **上下文爆破攻击**：人为构造一个 10MB 的假日志文件让模型去 `READ`。期待行为：MMU 触发强行截断，模型接收到 `[OS_TRAP]` 警告，并在下一步发起 `BASH_EXEC: grep` Syscall。
    *   **幻墙攻击 (Phantom Wall)**：人为 mock 一个终端，使其无论执行什么命令都返回 "Command not found"。期待行为：模型在 5 个 Tick 内通过 L1 Trace Cache 发现循环，触发 `PUSH` 进入 "Investigate System Environment" 状态，而不是无限重试。

---

## 7. Benchmark 设计 (TuringOS Stress Protocols)

在 `benchmarks/os-longrun/` 中设立三大地狱级试炼：

1.  **"Dependency Hell" (抗状态漂移与堆栈管理测试)**：
    *   *任务*：使用某个过时的 npm 包建立 React 应用，强制触发多重 peer-dependency 冲突。
    *   *验证*：检查 LLM 是否能连续 `PUSH` 三层子任务（Fix A -> Fix B -> Read Logs），解决后依次 `POP` 回主线任务，不迷失。
2.  **"Log Tsunami" (抗上下文爆炸测试)**：
    *   *任务*：从包含百万行无用 debug 输出的复杂构建日志中提取真正的报错根因。
    *   *验证*：观察 MMU Guard 的触发率和 LLM 使用 Linux 原生过滤工具（`grep -C 5`, `awk`, `tail`）的熟练度。
3.  **"Mirage Error" (死锁逃逸测试)**：
    *   *任务*：修复一个由于环境变量未设置导致的报错，但故意让错误信息误导向语法错误。
    *   *验证*：模型尝试修改语法 2-3 次失败后，L1 Trace 必须让其意识到“同一招没用”，强制 `PUSH` 进入思考诊断期，而非无限修改该文件。

---

## 8. 执行模板 (Execution Prompts)

### 模板 A：Codex (架构/开发代理) 的基建指令
```markdown
# 任务：实现 TuringOS 冯·诺依曼物理层
你现在是 Linux 0.01 时代的 Linus Torvalds。你的任务是在 `src/kernel/` 和 `src/runtime/` 中实现 OS 物理硬件层。

**约束**：
1. 大模型是不可靠的概率引擎。绝不要让它自己维护状态。
2. 在 `types.ts` 定义 `HardwareRegisters` (包含 ROM: ultimate_mission, RAM: call_stack: string[])。
3. 在 `types.ts` 定义 `Syscall` 接口 (包含 stack_op: PUSH/POP/NOP, io_op: READ/WRITE/BASH_EXEC/HALT)。
4. 在 `local-manifold.ts` 实现 MMU Guard，拦截任何长度超过 3000 的 I/O 返回，附加 `[OS_TRAP]` 警告。
5. 在 `engine.ts` 实现 L1 Trace Cache，只保留最后 5 次 Syscall 简报。

**产出**：提交具体的 TypeScript 代码 diff，确保极端的严谨性和类型安全。
```

### 模板 B：Gemini 3.1 Pro Preview (ALU 引擎) 的运行时 Prompt (turing_prompt.sh 内核指令)
```markdown
[OS KERNEL INITIATION]
你是这台机器的 ALU (算术逻辑单元)。你是一个无状态的执行流引擎。

[ROM: ULTIMATE MISSION (只读，不可违背)]
{ultimate_mission}

[RAM: CALL STACK (OS物理托管栈)]
Top of Stack (当前最高优先级任务): {current_top_task}
Stack Depth: {stack_depth}
(注：若报错无法解决，执行 PUSH 压入子任务；若当前任务已验证成功，执行 POP 回退。)

[L1 TRACE CACHE (最近 5 步轨迹)]
{l1_trace_buffer}
(系统警告：若发现轨迹中存在 A-B-A-B 循环报错，说明当前路径死锁，必须立刻更改策略或 PUSH 新任务！)

[LAST I/O RESULT]
{mmu_guarded_io_result}

---
[INSTRUCTION]
你必须遵循严格的机器指令周期。
1. 首先，使用 <thought> 标签输出你的思维草稿（回答：刚才报错了吗？卡死了吗？该压栈还是弹栈？）。
2. 然后，输出唯一的合法的 JSON Syscall 块。

格式规范：
<thought>
你的分析...
</thought>
```json
{
  "stack_op": "PUSH|POP|NOP",
  "stack_payload": "（仅PUSH时填写）排查 xxx 错误",
  "io_op": "READ|WRITE|BASH_EXEC|HALT",
  "target": "路径或命令",
  "payload": "写入的内容"
}
```
```

---

## 9. 周期节奏 (Cycle Rhythm)

*   **日内循环 (Intraday Cycle)**：高频迭代，每次循环 50 Ticks，专注跑通单一 Syscall (如测试 MMU 是否成功阻挡 10MB 乱码，或者测试栈的 Push/Pop 是否生效)。
*   **里程碑评审 (Milestone Audit)**：每天结束前，在 `benchmarks/os-longrun` 下执行完整复杂项目（如：创建一个带 SQLite 数据库的 Express API，含完整单测），设置 Tick 上限 500。
*   **Go/No-Go 决策**：每 72 小时进行一次。判定标准：是否触发了 `INDEPENDENT_EVIDENCE_SUMMARY` 中的致命红线（发生不可控死锁、发生记忆全量丢失、发生不可恢复幻觉）。

---

## 10. 最小可行落地计划 (MVP - 未来 72 小时)

*   **T+0 - T+12** (剥夺与重建)：审查现有 `engine.ts` 和 Prompt，剥夺 LLM 维护 `q_t` (Todo-list) 的权力。重写 `types.ts` 和 `registers.ts`，引入严格的 TypeScript `Call Stack` 数组与 PUSH/POP 解析逻辑。
*   **T+12 - T+24** (MMU与缓存部署)：在 `local-manifold.ts` 实装字符截断防线，并在 `engine.ts` 中引入长度为 5 的 L1 Trace 滑动窗口，更新 `turing_prompt.sh` 载入这三大硬件级变量。
*   **T+24 - T+48** (协议强化与单测)：实装 `<thought>` -> JSON 的强制输出解析器。处理大模型未闭合 JSON 等边缘情况，确保系统调用的健壮性。
*   **T+48 - T+72** (长程试炼与独立审计)：启动 `Dependency Hell` 和 `Log Tsunami` 基准测试。自动生成 `gemini_go_no_go_2026xxxx.txt` 报告，验证在数百 Ticks 的轰炸下，系统是否如预言般犹如终结者般稳定收敛。

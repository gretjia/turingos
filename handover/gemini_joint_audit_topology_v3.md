基于当前 TurosOS 代码库 (`src/kernel/engine.ts`, `src/kernel/types.ts`, `src/oracle/universal-oracle.ts`, `src/manifold/local-manifold.ts`) 对照 Topology v3.0，以下是可执行的工程审查报告：

# TuringOS Topology v3.0 联合审查工程报告

### 一、 审查结论表

| 审查项 | 状态 | 详情与代码现状对应 |
| :--- | :--- | :--- |
| **严格同步Tick** | ✅ **已满足** | `TuringEngine.tick(q_t, d_t)` 和 `ignite()` 实现为纯粹的 `async/await` 轮询状态机，完全阻断了异步事件驱动（Event-loop）或并发抢占干扰思考链路。 |
| **HALT Gate** | ✅ **已满足** | `engine.ts` 中实现了明确的逻辑：先检查物理验证证据 (`checkRecentVerificationEvidence()`)，再结合执行契约 (`checkHalt()`)。非法停机直接转化为 `[OS_TRAP: illegal_halt]` 和重试反馈。 |
| **内容契约** | ✅ **已满足** | `engine.ts` 使用 `containsLazyWriteMarker` 对写入负载正则过滤，精准拦截懒惰编写 (`// ... existing ...` 等)，违规直接抛出 `[OS_TRAP: CONTENT_CONTRACT_VIOLATION]`。 |
| **Watchdog** | ✅ **已满足** | `engine.ts` 实现了硬件中断级的看门狗：记录深度的 `watchdogHistory` 追踪 `actionHash`，同一动作重复 5 次即触发 `[OS_TRAP: WATCHDOG_NMI]` NMI 中断强制纠偏。 |
| **API重试** | ✅ **已满足** | `UniversalOracle` 针对 OpenAI 和 Kimi 实现基于指数退避算法（Exponential Backoff）的健壮 `withRetry` 机制，妥善处理了限流及底层网络断开等情况。 |
| **Turing ISA/ABI** | ❌ **未满足** | **现状**：混合动作空间，`ActionOperator` 仅简单支持 `WRITE/GOTO`，堆栈操作由独立的 `stack_op` 处理，命令执行隐式挂载在 `$` 指针语法糖上。<br>**要求**：须重构为绝对互斥的 `SYS_WRITE / SYS_GOTO / SYS_EXEC / SYS_PUSH / SYS_POP / SYS_HALT`。 |
| **Typed Paging** | ❌ **未满足** | **现状**：对于超长文件粗暴采用 `MMU_TRUNCATED` 进行硬截断，或者全量吐出整个文件，没有“页面”、“焦点”等心智模型。<br>**要求**：需实现 `[PAGE_TABLE_SUMMARY] + [FOCUS_PAGE_CONTENT]` 以及支持翻页参数的 `SYS_GOTO`。 |
| **Deterministic Replay** | ❌ **未满足** | **现状**：`engine.ts` 仅使用 `this.chronos.engrave(...)` 写入了含 Tick、操作摘要的纯文本可读日志。<br>**要求**：落盘完全去语境的确定性签名日志：`<hash(q_t), hash(s_t), a_t>`。 |

---

### 二、 按优先级的实施计划（Patch Plan）

#### **P0: 强制落地 Turing ISA/ABI (统一底层模型动作空间)**
- **1. 文件:** `src/kernel/types.ts`
  - **变更点:** 废弃原有混合的 `ActionOperator` 及分散的 `stack_op`。新建联合体 `Syscall`。
  - **代码指示:**
    ```typescript
    export type Syscall = 
      | { sys: 'SYS_WRITE'; target: string; payload: string }
      | { sys: 'SYS_GOTO'; handle: string }
      | { sys: 'SYS_EXEC'; cmd: string }
      | { sys: 'SYS_PUSH'; task: string }
      | { sys: 'SYS_POP' }
      | { sys: 'SYS_HALT' };
    
    // 更新 Transition 的类型
    export interface Transition {
      thought?: string;
      q_next: State;
      a_t: Syscall; // 取代旧有的 stack_op 等结构
    }
    ```
- **2. 文件:** `src/oracle/universal-oracle.ts`
  - **函数名:** `parseTransition` / `tryNormalizeTransition` 及其相关校验辅助。
  - **变更点:** 更新解析和向下兼容层。强校验 JSON 中 `sys` 字段为上述六大枚举，如果不存在则抛出或格式化异常为指令失效，抛弃以往针对 `s_prime` 和 `d_next` 的探测逻辑。
- **3. 文件:** `src/kernel/engine.ts`
  - **函数名:** `tick`
  - **变更点:** 将原本散落在开头的 `$` 指令检查与底部的写入检查，收束进一个大的 `switch (transition.a_t.sys)` 原子分发器。

#### **P1: 实现 Typed Paging 分页渲染 (解除上下文破窗隐患)**
- **1. 文件:** `src/manifold/local-manifold.ts`
  - **函数名:** `observe` / `guardSlice` 及其相关文件读写方法。
  - **变更点:** 引入虚拟页尺寸概念（如：150行/页 或 3000 chars/页）。如果单文件超出阈值，不再直接截断。
  - **变更细节:** 在返回给 ALU 的 `Slice` 头部注入 `[PAGE_TABLE_SUMMARY] (Total Pages: 4, Current Focus: 2)`。同时在 `SYS_GOTO` 的实现中加入参数解析：允许句柄采用类似 `sys://goto/file?page=2` 的语法来转移模型的焦点页。

#### **P2: 植入 Deterministic Replay 确定性元组 (可证数据与时间机器基础)**
- **1. 文件:** `src/kernel/engine.ts`
  - **函数名:** `tick`
  - **变更点:** 就在 `this.chronos.engrave(...)` 可读日志被写入的核心逻辑块上方。
  - **变更细节:** 使用 `node:crypto`。
    ```typescript
    const hashQ = createHash('sha256').update(q_t).digest('hex');
    const hashS = createHash('sha256').update(s_t).digest('hex');
    const replayTuple = JSON.stringify({ h_q: hashQ, h_s: hashS, a_t: transition.a_t });
    await this.chronos.engrave(`[REPLAY_TUPLE] ${replayTuple}`); // 或写入专属 *.replay.jsonl 中
    ```

---

### 三、 风险与回归测试清单

#### **1. 系统级风险评估**
- 🛑 **Prompt Drift（系统提示词漂移死锁）**: 将隐式指令（像 `$` 和 `stack_op`）升级为显式的 `SYS_*` 的硬约束后，现存的底层系统提示（如 `disciplinePrompt`）如果还在教模型输出老式 JSON 结构，会导致疯狂触发 `CPU_FAULT` 陷阱，陷入无法跳出的循环。**需伴随修改 Prompts 引导**。
- 🛑 **翻页饥饿陷阱**: Paging 系统实装后，模型可能因为理解错误而陷入连续 `SYS_GOTO` 上下翻页的死循环。需保证 Watchdog 和 L1TraceCache 将纯翻页动作也纳入防锁死监测之中。

#### **2. Regression Checklist (回归验证点)**
- [ ] **执行器拦截防逃逸**: 检查当模型调用 `{ sys: 'SYS_EXEC', cmd: 'npm test' }` 时，是否确实被引擎拦截不再直接改变当前指向指针，并确切在下一次周期正确捕获和吐出了带有 `[EXIT_CODE]` 的 `s_t` 切片。
- [ ] **HALT 栅栏穿透检测**: 构造一次包含有效 `SYS_HALT` 的大模型输出，确信它必须先被新版 Engine 分发给 HALT_GUARD；确认如果缺乏物理检验（如无 `SYS_EXEC` 测例历史）依然能强制拒绝 HALT。
- [ ] **旧依赖向下阻断测试**: 模拟传入带旧 `stack_op: 'PUSH'` 和 `d_next` 的 JSON 输出，确认 Oracle 的重构层能否正确抛错，要求引擎向模型弹回 Schema 不匹配的 `CPU_FAULT`。
- [ ] **Deterministic Log 幂等性校验**: 单步跑一个简单的用例停机，从持久化日志中提取出 `hash(q)` 与 `hash(s)`，手动执行一次 `oracle.collapse` (Temperature=0)，检查吐出的 `a_t` 是否与重放日志中的行为严丝合缝对齐。

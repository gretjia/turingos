# 差异审计报告：TuringClaw vs TuringOS

基于 A/B 测试证据及代码对比，`turingos` 胜率归零（0/3）且满负载超时（max-tick hit 1.00）的根本原因是**其引入了过多过严的系统级拦截（Traps）与契约断言**，导致 LLM 在尝试完成任务时陷入了无穷无尽的错误恢复循环（如 `IO_FAULT`, `PAGE_FAULT`, `L1_CACHE_HIT`）。相较之下，`turingclaw` 信任 LLM，且对冗余操作有更高的容忍度。

以下是导致这一结果的前 10 个核心代码级差异：

## Top 10 关键差异分析

### 1. HALT 停机门控过严 (HALT Guard Blocking)
*   **影响机制**：TuringOS 在收到 `HALT` 指令时，强制校验是否有近期的物理验证证据（执行过 ls, cat, npm test 等）以及进度契约是否完整。若不满足则强行拦截并分配至 `sys://trap/illegal_halt` 或 `halt_guard`。LLM 极难自行猜测并满足这套隐藏逻辑，导致长期困在引擎里直至超时。
*   **证据路径**：
    *   `turingos/src/kernel/engine.ts` (`checkRecentVerificationEvidence` 与 `executionContract.checkHalt`)
    *   `turingclaw/server/control/halt_protocol.ts` (直接放行)
*   **风险等级**：**极高 (Critical)**
*   **修复建议**：移除或降级 HALT 的物理强制校验，让 LLM 主观判断任务完成即可停机。

### 2. 执行进度契约导致 IO_FAULT (Execution Contract Enforcements)
*   **影响机制**：TuringOS 引入了 `sys://append/` 与 `executionContract` 来要求 LLM 必须按严格顺序追加 `DONE:xxx`。一旦追加内容不合规、存在重复，或前置依赖文件未生成，直接抛出 `[OS_TRAP: IO_FAULT]` 或 `PLAN_CONTRACT` 违规。这在 benchmark evidence 中产生了大量的 IO_FAULT。
*   **证据路径**：
    *   `turingos/src/kernel/engine.ts` (`normalizeProgressPayload`, `checkProgress`)
    *   `turingclaw/server/engine.ts` (无任何进度契约拦截)
*   **风险等级**：**极高 (Critical)**
*   **修复建议**：取消强制的 `sys://append/` 语法与步骤前置依赖校验，允许自由追踪进度。

### 3. L1 缓存短循环过敏 (Aggressive L1 Cache Trap)
*   **影响机制**：TuringOS 将 `l1TraceDepth` 设置为极短的 3。当 LLM 连续执行相同的观察/干涉（例如因为出错重试），立刻触发 `[OS_TRAP: L1_CACHE_HIT]` 陷阱并强行中断操作。TuringClaw 的 watchdog 阈值更大（4 次连续或 12 次滑动窗口），且处理更柔和。
*   **证据路径**：
    *   `turingos/src/kernel/engine.ts` (`l1TraceCache` 拦截逻辑)
    *   `turingclaw/server/control/progress_watchdog.ts` (窗口容限更大)
*   **风险等级**：**高 (High)**
*   **修复建议**：增大 `l1TraceDepth` (如提升至 5-10) 或放宽对重试行为的判定。

### 4. 文件不存在被捕获为页面错误 (PAGE_FAULT vs FILE_NOT_FOUND)
*   **影响机制**：当读取不存在的文件时，TuringOS 将 `ENOENT` 升级为冗长的 `[OS_TRAP: PAGE_FAULT]`，携带详尽的上级目录状态和修复建议指令。这常常过度吸引 LLM 的注意力，把普通的“探路”行为变成了严重的系统级异常。
*   **证据路径**：
    *   `turingos/src/kernel/engine.ts` (`observe` catch 块的 `PAGE_FAULT`)
    *   `turingclaw/server/adapters/manifold.ts` (仅返回 `[FILE_NOT_FOUND]`)
*   **风险等级**：**高 (High)**
*   **修复建议**：简化 `ENOENT` 的错误返回，仅提供纯文本提示，不作为系统级 Trap 抛出。

### 5. 内容契约阻断占位符 (Content Contract Violation)
*   **影响机制**：TuringOS 检测写入内容（`s_prime`）是否包含 `// ... existing ...` 等懒惰省略标记，一旦包含则拒绝写入并触发 `[OS_TRAP: CONTENT_CONTRACT_VIOLATION]`。在长代码修复中，这会导致合法的分步更新被反复拦截。
*   **证据路径**：
    *   `turingos/src/kernel/engine.ts` (`containsLazyWriteMarker`)
    *   `turingclaw/server/engine.ts` (照单全收)
*   **风险等级**：**高 (High)**
*   **修复建议**：移除懒惰写入标记的正则拦截，允许 LLM 在适当情况下使用占位符或分段更新。

### 6. MMU 观测切片硬截断 (Strict MMU Truncation)
*   **影响机制**：TuringOS 在 `local-manifold.ts` 将所有观测结果硬截断在 3000 字符，并附加 `[OS_TRAP: MMU_TRUNCATED]` 警告。大型源文件直接无法完整读取，诱发 LLM 额外调用冗余的 `grep` / `sed` 命令来阅读，引发混乱。
*   **证据路径**：
    *   `turingos/src/manifold/local-manifold.ts` (`maxSliceChars` 设置)
    *   `turingclaw/server/adapters/manifold.ts` (无严格观测字符数限制)
*   **风险等级**：**中 (Medium)**
*   **修复建议**：将 `maxSliceChars` 放宽至 `16384` 或更高，或仅阶段性截断而不引发 Trap。

### 7. 状态上下文高强度污染 (Observation Context Bloat)
*   **影响机制**：TuringOS 在每次 tick 时都会将 `[OS_CONTRACT]`, `[L1_TRACE_CACHE]`, `[OS_CALL_STACK]` 等大段控制面信息硬塞入 `s_t` 切片头部。过多的系统噪音降低了核心任务（代码输出、文件内容）的信噪比。
*   **证据路径**：
    *   `turingos/src/kernel/engine.ts` (tick 中的 `s_t` 字符串拼接)
    *   `turingclaw/server/adapters/manifold.ts` (仅在开启时附带极简的 MAIN_TAPE_CONTEXT)
*   **风险等级**：**中 (Medium)**
*   **修复建议**：移除强制挂载的堆栈和契约日志，保持观测信道 `s_t` 绝对纯净。

### 8. 重复成功命令被判无进展 (NO_PROGRESS Trap)
*   **影响机制**：若 LLM 连续执行同样的合法终端命令并获得同样成功的输出（Exit Code 0），TuringOS 会主动注入 `[OS_TRAP: NO_PROGRESS]` 警告，干扰了 LLM 的安全检查与轮询重试。
*   **证据路径**：
    *   `turingos/src/kernel/engine.ts` (`repeatedSuccessfulCommand` 拦截)
    *   `turingclaw/server/engine.ts` (信任正常重试逻辑)
*   **风险等级**：**中 (Medium)**
*   **修复建议**：允许安全状态下的重复确认，移除 NO_PROGRESS 的硬性 Trap。

### 9. sys://replace 的异常限制逻辑
*   **影响机制**：TuringOS 的 `sys://replace/` 机制在无替换发生时，强制抛出 `Replace search token not found` 或 `produced no changes` 等异常（进而转换为 IO_FAULT）。相比之下，TuringClaw 将全量文件直接写入 `s_prime` 交由底层处理，逻辑健壮。
*   **证据路径**：
    *   `turingos/src/manifold/local-manifold.ts` (`applyReplaceSyscall` 异常处理)
    *   `turingclaw/server/adapters/manifold.ts`
*   **风险等级**：**中 (Medium)**
*   **修复建议**：简化 `sys://replace/` 失败反馈，允许降级覆盖写入，不抛出阻断性异常。

### 10. 陷入深度恐慌重置 (Panic Reset via Infinite Loop Guard)
*   **影响机制**：TuringOS 添加了 `trapPointerHistory` 追踪，如果触发 4 次同样的 Trap，会直接重置 `q_t` 状态并抛出 `[OS_PANIC: INFINITE_LOOP_KILLED]`。这强行截断了 LLM 的连贯上下文，破坏了解题节奏。
*   **证据路径**：
    *   `turingos/src/kernel/engine.ts` (`trackTrapPointerLoop`)
    *   `turingclaw/server/engine.ts` (依赖状态机自然演化恢复)
*   **风险等级**：**低 (Low)**
*   **修复建议**：废除 Panic Reset 机制，不阻断 LLM 的连贯思维链恢复过程。

---

## 最小修复序列 (7步极简修复方案)

按以下顺序对 `turingos` 实施控制拦截削弱，即可恢复类似于 `turingclaw` 的全通关表现：

1.  **解除 HALT 验证强制**：在 `turingos/src/kernel/engine.ts` 的 `tick()` 循环中，删除 `checkRecentVerificationEvidence()` 以及 `checkHalt()` 两项强制拦截检查，满足 `HALT` 指令时直接放行。
2.  **削弱进度契约阻断**：在 `engine.ts` 中移除拦截 `executionContract.checkProgress()` 并抛出 `[OS_TRAP: PLAN_CONTRACT]` 的系统性限制。
3.  **关闭内容契约限制**：在 `engine.ts` 删除涉及 `containsLazyWriteMarker` 的条件分支，不再对 payload 进行 `// ... existing ...` 的严格正则拒写。
4.  **放宽短循环熔断拦截**：将 `engine.ts` 中 `this.l1TraceDepth` 的值由 `3` 修改为 `10`，或者直接将 `l1LoopDetected` 强制设为 false 关闭防连发拦截。
5.  **软化文件丢失异常提示**：修改 `engine.ts` 在观测异常进入 Catch 块时的赋值逻辑，使其仅返回朴素的 `[FILE_NOT_FOUND]` 切片，不再附带长篇 `[OS_TRAP: PAGE_FAULT]` 指令。
6.  **移除过多系统控制切片注入**：在 `engine.ts` 拼接传递给 oracle 的 `s_t` 时，取消对 `[OS_CONTRACT]`、`[L1_TRACE_CACHE]` 和 `[OS_CALL_STACK]` 等环境变量信息的自动串联注入，减轻上下文污染。
7.  **提升 MMU 观测窗口**：在 `turingos/src/manifold/local-manifold.ts` 中，调整默认参数 `options.maxSliceChars` 从 `3000` 放宽至 `16384` 或无限长。

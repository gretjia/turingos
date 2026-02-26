基于对 `os-longrun-20260226-044833.json` 结果和源代码的联合分析，Topology v3.0 落地后测试通过率仅为 1/4（仅 `home1_parity_sim` 通过）的核心原因在于 **严格的契约检验机制与 Auto-heal / 防死循环拦截器产生了灾难性的耦合冲突**。

以下是具体的联合复盘报告：

### 1) 根因 (Root Cause)

1. **自动修复引发的数据毁灭 (Auto-heal Data Corruption)**
   - **现象**：`fault_recovery_resume` 连续触发 22 次 `PAGE_FAULT` 且因为 `text mismatch` 一直卡死。
   - **根本原因**：`engine.ts` 在自动修复文件（Auto-heal）时，依赖 `extractExpectedExact` 使用正则从 `reason` 字符串（形如 `expected="..."`）中提取期望文本。然而，`file-execution-contract.ts` 在生成这个错误信息时，调用了 `this.preview()`，该函数会将文本**去掉换行、压缩空格，并截断至 177 字符且拼接 `...`**。结果 Auto-heal 机制不仅没能修复文件，反而用被截断的乱码覆盖了源文件，导致后续模型永远无法通过 `exact-text` 验证，陷入永久死锁。
2. **操作动作签名存在哈希碰撞 (Action Signature Blindspot)**
   - **现象**：`pipeline_ordered_execution` 触发了 `Kernel panic reset: repeated trap pointer loop detected`（L1 缓存命中循环）。
   - **根本原因**：在 `engine.ts` 中，防止模型死循环的 `actionSignature` 仅仅对 `d_next`（指针）和 `s_prime` 进行了哈希。但针对纯调度型 syscall（如 `SYS_PUSH`、`SYS_POP`、`SYS_EXEC`），它们的 `s_prime` 均被硬编码为了占位符 `'👆🏻'`。这意味着只要模型在同一个当前指针下（比如连续 PUSH 两个不同的 Task，或 PUSH 后 POP），动作摘要就会产生碰撞。系统错误地认为模型陷入了死循环，进而直接抛出 Panic 将正常的 Pipeline 执行阻断。
3. **`sys://replace/` 禁用了新文件创建 (Replace Syscall Blockage)**
   - **现象**：`long_checklist_stability` 最终停在了 `sys://replace/milestones/m06.txt` 且超时未通过。
   - **根本原因**：模型尝试使用 `sys://replace` 通道创建或全量覆盖一个新的 Milestone 文件（当作 fallback 策略）。然而 `local-manifold.ts` 中的 `applyReplaceSyscall` 在第一行进行了硬校验：`if (!fs.existsSync(targetPath)) throw new Error(...)`。这导致了 `IO_FAULT`。模型为了创建必须的步骤文件而不断被系统拦截。

---

### 2) 修复清单 (P0/P1 最小修复集)

为了最小化架构改动，重点处理上述机制缺陷，以下是最多 4 条的高优修复计划：

**[P0] Fix 1: 透传真实的 Expected Text (解决 Auto-heal 乱码)**
- **文件**: `src/kernel/types.ts` & `src/runtime/file-execution-contract.ts`
- **函数**: `ContractCheckResult` 接口 & `checkStepReady`
- **改法**: 在 `ContractCheckResult` 中新增可选属性 `expectedExact?: string`。当 `kind === 'text'` 校验失败时，除了返回包含 preview 的 reason 外，直接将原生的 `expectation.exact` 赋值给 `expectedExact`。
- **预期收益**: 停止在日志字符串中进行脆弱的正则解析。

**[P0] Fix 2: 重构 Auto-heal 取值逻辑 (解决 Auto-heal 乱码)**
- **文件**: `src/kernel/engine.ts`
- **函数**: `tick`
- **改法**: 移除 `extractExpectedExact` 的正则提取逻辑。将对期望值的获取改为直接读取透传的属性 `const expectedExact = readiness.ok ? null : (readiness as any).expectedExact ?? null;`。
- **预期收益**: 让 Auto-heal 能够写入包含正确换行和长度的、绝对原生的 Expectation String。彻底打通 `fault_recovery_resume` 的文件就绪验证。

**[P0] Fix 3: 消除 L1 Cache 的哈希碰撞 (解决流水线调度误杀)**
- **文件**: `src/kernel/engine.ts`
- **函数**: `actionSignature` 及 `tick` 中的调用点
- **改法**: 将 `actionSignature(dNext, sPrime)` 的签名扩展为 `actionSignature(dNext, sPrime, syscallNote)`。在 `tick` 中将已存在的 `syscallNote`（即 `this.renderSyscallNote(transition)`）一同混入 sha256 哈希串中。
- **预期收益**: `SYS_PUSH(task=A)` 和 `SYS_PUSH(task=B)` 的动作签名将完全不同，模型能够在同一指针位置流畅编排多个 Pipeline 任务，修复 `pipeline_ordered_execution` 崩溃问题。

**[P1] Fix 4: 允许 Replace Syscall 的全量创建 Fallback (解决长列表阻塞)**
- **文件**: `src/manifold/local-manifold.ts`
- **函数**: `applyReplaceSyscall`
- **改法**: 放宽文件不存在时的阻塞条件。当 `!fs.existsSync(targetPath)` 时，尝试检查 payload 是否为 JSON。如果 payload 是纯文本（即 JSON.parse 失败），则自动创建父目录并 `fs.writeFileSync` 写入该文件然后 `return`；若是 JSON 补丁格式则继续抛出异常。
- **预期收益**: 允许模型使用 `sys://replace/` 平滑退退化为 `sys://` 写入新文件，不再抛出误导性的 `IO_FAULT`，打通 `long_checklist_stability` 中 M06-M08 文件的创建流程。

---

### 3) 回归用例 (Regression Test Cases)

请在修复后优先执行以下单元级验证：
1. **Auto-heal 数据无损验证**: 构造一个 contract，要求某文件包含多行超长文本，初始环境填入任意错值。模拟引擎 tick 一次后，读取文件，断言内容长度与预期绝对一致，且不包含 `...` 等截断字符。
2. **L1 Bypass 验证**: 将 `initialD` 设为 `$ pwd`，强制预设 Oracle 连续吐出 3 个不一样的 `SYS_PUSH(task="task1/2/3")` 的 Transition。断言 `tick` 的输出中不会抛出 `[OS_TRAP: L1_CACHE_HIT]`。
3. **Replace 新建文件验证**: 调用 `manifold.interfere('sys://replace/new_milestone.txt', 'M06 content')`。断言调用不会抛出异常，且 `new_milestone.txt` 被成功创建并写入对应内容。

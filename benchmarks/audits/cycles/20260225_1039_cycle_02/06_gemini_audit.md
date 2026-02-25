# Cycle 02 独立审计报告

## 1. Findings（按严重级排序）
- **P0: 严重违反稳定性验收标准 (Page Fault 剧增)**
  证据表明 `page_fault_avg` 从 Baseline 的 3.6667 恶化至 7.6667（增幅达 +4）。在 `fault_recovery_resume` 场景中，单次运行出现了高达 20 次 PAGE_FAULT（见 `05_test_results.md`）。这是由新增的 `thought`, `stack_op`, `stack_payload` JSON 字段增加了模型格式化难度，导致模型最终输出非合法 JSON（例如 `fault_recovery_resume` 的 finalQ 降级为纯文本 `"1. POP recovery frame 2. Append DONE:RESULT..."`）从而触发了大量的解析异常（Page Fault）。
- **P1: 严格拦截导致的 IO_FAULT 增加**
  引入了对 `sys://append/plan/progress.log` 的严格前置校验 (`normalizeProgressPayload`)。不合规的写入被拦截并转化为 `sys://trap/io_fault`，导致 `IO_FAULT` 平均值从基线的潜在低位上升至 1.6667。虽然这成功阻止了错误或无序的进度写入，但也增加了陷入 Trap 纠错循环的几率。
- **P2: Plan Adherence 显著提升（正面发现）**
  得益于 `NEXT_REQUIRED_DONE` 契约提示和严格的日志写入拦截，`plan_avg` 指标获得了大幅改善，从 0.2937 跃升至 0.619（提升 +0.3253）。这证明了核心干预策略在逻辑上是高度有效的。

## 2. Go/No-Go 结论
- **结论：** **No-Go**
- **理由：** 严格违反了 Scope 中定义的 Acceptance Gate 标准：“No regression in watchdog/page-fault stability”。证据路径：`metrics_compare_vs_cycle01post.json` 中明确记录 `"page_fault_delta": 4`，且 `page_fault_after` 飙升至 7.6667。

## 3. 最小修复清单
- **文件：`benchmarks/os-longrun/discipline_prompt.txt` 及 `turing_prompt.sh`**
  - **改动：** 精简 JSON 协议。移除新增的 `stack_op` 和 `stack_payload` 作为独立强制 JSON 字段的要求（或者将其设为可选）。复杂的 JSON Schema 破坏了基础的指令遵循，导致模型格式崩溃。建议将栈操作指令转为 `q_next` 内的纯文本约定。
- **文件：`src/kernel/engine.ts`**
  - **改动：** 优化 `sys://trap/io_fault` 的 Details 信息。当 `normalizeProgressPayload` 失败时，不仅提示 `Action: append exact line...`，应明确给出一个**绝对正确的 JSON 载荷示例**，帮助模型快速从 Trap 中恢复。

## 4. 回归建议
- **必须复跑的测试：** 运行相同的 `bench:os-longrun`（包含所有 3 个 scenario）。
- **通过标准：**
  1. `page_fault_avg` 必须消除回归，恢复至 <= 3.6667（Cycle 01 乃至更低水平）。
  2. `plan_avg` 必须维持在 >= 0.60（保住本轮逻辑修改带来的收益）。
  3. `watchdog_avg` 保持为 0。

---

## 额外要求响应

**1) 是否通过 Cycle 02 gate？**
**未通过。** 虽然在 Plan adherence 上达成了改善目标，但在 `page_fault` 稳定性上出现了直接且严重的回归（数量翻倍），一票否决。

**2) 是否有继续修正下去的必要性？**
**有极高的必要性。** 证据表明 `[NEXT_REQUIRED_DONE]` 的上下文注入和严格进度控制（`normalizeProgressPayload`）成功将计划依从性 (`plan_avg`) 提升了一倍以上。当前的失败（Page Fault 飙升）仅仅是由于过度复杂的 JSON 输出格式要求附带损伤了模型的格式稳定性。核心策略方向是正确的，只需修复协议的副作用即可通关。

**3) 最小下一步清单 (<=4项)**
1. **回退 Prompt JSON 结构**：撤销 `stack_op` 和 `stack_payload` 作为顶层 JSON key 的强制要求，退回基础的 `{q_next, s_prime, d_next}` 结构，可保留 `thought` 作为可选字段。
2. **将 Stack 操作降级为内部协议**：如果仍需保留 PUSH/POP 概念，将其整合到 `s_prime` 或 `q_next` 的自然文本中（如通过特定前缀），由引擎使用正则提取，卸载模型的 JSON 生成负担。
3. **强化 IO_FAULT/Parse Error 的容错**：当引擎捕获到 JSON 解析错误时，生成的 Trap 信息中直接回显正确的 JSON 模板，阻断连续的 Page Fault。

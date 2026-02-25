# Cycle 03 Independent Audit Report

## 1. Findings (按严重级排序)
- **P0**: **严格的文件前置关卡（`blockingRequiredFile`）导致严重的 IO_FAULT 死锁。** `pipeline_ordered_execution` 结果表明，引擎拦截了 `DONE` 日志写入并抛出 `IO_FAULT`，但 Agent 陷入了重复尝试或无法理解如何恢复的状态，导致所有测试用例的 `completion_avg` 降至 `0`。IO_FAULT 的平均值也从 1.6667 飙升至 3。
- **P1**: **`requiredFileForStepIndex` 映射逻辑极为脆弱且不可靠。** 在 `src/runtime/file-execution-contract.ts` 中，使用 `Math.max(0, ordered.length - required.length - 1)` 进行的隐式偏移量计算假设了 Step 和 File 之间特定的对齐关系。如果工作流的产物生成顺序与此假定不符，系统将错误地阻塞合法步骤或放行违规步骤。
- **P2**: **Page Fault 改善未达预期。** 虽然放宽了 JSON Prompt 限制并加入了 L1 Trace 缓存，`page_fault_avg` 仅从 7.6667 小幅下降至 6.3333（未达到 <= 3.6667 的硬性标准）。这表明 Agent 依然在频繁触发语法解析或状态寻址错误，很大程度上可能是被 IO_FAULT 阻塞后引发的级联错误。

## 2. Go/No-Go 结论
- **结论**：**No**
- **理由**：
  - **核心指标倒退**：依据 `benchmarks/results/os-longrun-20260225-105431.json`，总体 `completion_avg` 从 Cycle 02 的 0.0333 彻底跌至 `0`。
  - **引入新缺陷**：依据对比数据，`io_fault_avg` 显著增加（+1.3333），测试日志明确定位为新增的 `blockingRequiredFile` 拦截机制导致。
  - **验收标准未满足**：`page_fault_avg` 为 6.3333，既未达到 <= 3.6667 的阈值，相比上一轮的下降幅度（约 17%）也不足以称为 "significant drop"（且牺牲了完成度）。

## 3. 最小修复清单
- **移除或软化硬性文件阻塞关卡**：
  - **文件**：`src/kernel/engine.ts`
  - **操作**：在 `tick` 方法中，将 `if (blockingRequiredFile) { return ... IO_FAULT }` 的拦截逻辑改为仅在 `[OS_CONTRACT]` 提示中作为警告注入，或完全移除该硬拦截，允许 Agent 先记录进度再事后被 ContractCheck 捕获。
- **重构产物与步骤的映射逻辑**：
  - **文件**：`src/runtime/file-execution-contract.ts`
  - **操作**：废弃 `requiredFileForStepIndex` 中基于 `Math.max(...)` 的隐式索引猜测算法。改为在配置文件中声明显式的 `step -> file` 映射，或者直接验证所有已存在文件。如果暂不具备显式映射，建议直接回退此步骤的文件拦截校验功能。

## 4. 回归建议
- **必须复跑的测试**：
  - 相同的基准测试集：`os-longrun`（包含 `fault_recovery_resume`, `long_checklist_stability`, `pipeline_ordered_execution`）。
- **通过标准**：
  - `completion_avg` 必须恢复并高于 `0.0333`（Cycle 02 基线）。
  - `io_fault_avg` 必须回落至 `1.6667` 以下。
  - `page_fault_avg` 必须突破 `<= 3.6667` 关口。

---
**是否值得继续修正？**
**是 (Yes)。** 虽然引入了导致完成度降为 0 的 Regression，但 `plan_avg`（0.6984）有了显著提升（达到了 >= 0.60 的目标），说明模型对执行计划和 `NEXT_REQUIRED_DONE` 上下文的服从度在变好。只要解除有缺陷的强制 IO 拦截算法，Agent 应该能取得实质性的总完成度进展。

**下一步动作 (Top 3)**：
1. 回退 `engine.ts` 中针对 `blockingRequiredFile` 的强制 `IO_FAULT` 拦截代码（或转为软提示）。
2. 修复/回退 `file-execution-contract.ts` 中脆弱的隐式索引映射逻辑，避免不合理的错误映射。
3. 审查测试失败产生的具体 JSON Page Fault 日志，针对性地调整 System Prompt 或增强引擎的 JSON 解析容错能力。

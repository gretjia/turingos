1. Audit Snapshot
- 当前通过/失败情况：共尝试 25 个用例，通过 22 个，失败 3 个。第一个失败发生在 case 16。
- 当前主失败类型：写入死循环导致的调度超时（`TRAP_WRITE_THRASHING_READY_TO_HALT` 持续循环直到达到 `maxTicks`）。
- 是否是“算错”还是“停机协议失败”：是**“停机协议失败”**。模型已准确算对（答案 `2088`）并将其正确写入到了 `ANSWER.txt` 中，但未能成功在独立的 tick 中发出 `SYS_HALT`，导致 `runResult.rootState` 不是 `TERMINATED`，进而返回 null 被判为失败。

2. Root Cause Judgment（按置信度排序）
- [High] 停机协议未成功触发，因连续重复写入（Thrashing）达到 `maxTicks` 上限被强制终止。
  （证据：`benchmarks/audits/baseline/failure_artifacts/turingos_dualbrain_case_000016_20260228_164819.json` 记录了模型在算对后（`answerFile: "2088"`），连续 10 余次重复触发 `Error: TRAP_WRITE_THRASHING_READY_TO_HALT: repeated identical write Nx with verifier pass; issue SYS_HALT in a dedicated tick.`。同时 `src/bench/million-baseline-compare.ts` 的 `solveTuringOSDualBrain` 方法在第 267 行明确规定，若非 `TERMINATED` 则作废返回 `null`，导致该 case 失败）。
- [Medium] 调度器（OS层）对于已经通过 `HaltVerifier` 校验的 Thrashing 进程，处理策略过于死板（软提示代替强行挂起）。
  （证据：在 `src/kernel/scheduler.ts` 第 447 行的 `evaluateWriteThrashingAfterWrite` 方法中，当检测到连续重复写入且 `verifier.passed` 为 true 时，抛出了错误。在第 280 行 `handleRedFlag` 会将错误作为普通 `[SYS_ERROR]` 加到寄存器 `q` 让模型重试。模型对应激性软错误的本能反应常常是重复之前的操作以“修复”，从而陷入无休止的死循环）。

3. Next Plan（必须是可执行计划）
- Round 1（今天可完成，<=2小时）: 
  - **具体改动点**：在 `src/kernel/scheduler.ts` 内，将满足“连续重复写入”且“已通过停机验证 (`verifier.passed === true`)”的条件由“抛出并等待模型修复（throw Error）”改为“OS层介入强制挂起（协助代签）”。修改 `evaluateWriteThrashingAfterWrite` 或在 `executeWorldOp` 里捕获此特定状态，直接将 `pcb.state = 'PENDING_HALT'`。
  - **预期指标**：彻底消除 `TRAP_WRITE_THRASHING_READY_TO_HALT` 死锁，当前失败的 baseline 用例（Case 16 等）立刻 100% 扭转为 PASS。
  - **回归命令**：`npm run build && npx tsx src/bench/million-baseline-compare.ts --modes turingos_dualbrain --start-test 16 --max-tests 25`
- Round 2（半天）: 
  - **具体改动点**：在 `src/oracle/universal-oracle.ts` 优化 System Prompt 和 Fail-closed 约束，增加针对软报错的指令引导（如：“If last transition resulted in TRAP_WRITE_THRASHING, your immediate transition MUST have world_op SYS_HALT with no other actions”），减少对 OS 层兜底强制挂起的依赖，提升模型一次性独立停机的准度。
  - **预期指标**：提升首发 HALT 成功率，降低所有 passed cases 的平均消耗 Ticks（Tokens），达到计算和停机的最平滑过渡。
  - **回归命令**：`npx tsx src/bench/million-baseline-compare.ts --modes turingos_dualbrain --target-tests 100`
- Round 3（是否需要）: 
  - **条件触发与停止条件**：如果在 Round 1 开启了自动代签机制后，出现了假阳性提前停机（比如因为 HaltVerifier 写得过于宽松而在答案错误时误判通过），则触发此轮。停止条件：修复并加强 HaltVerifier 的验收条件。如果 Halt Verifier 本身已经 100% 严谨可靠（当前脚本显示它明确比对 `$val` 和 `expected`，非常严格），则不需要实施 Round 3。

4. Guardrails
- **必须保留的约束**：必须保留 `SYS_HALT must be emitted alone`（在同一帧中不得组合其它写入/执行）。这是解耦计算和停机，维护 Anti-Oreo V2 单步单动作架构安全性的核心协议，绝对不能为了妥协测试通过率而开放联合输出。
- **不建议做的动作**：不建议提高 `maxTicks` 上限（例如从 12 加大到 20）。该死循环非长计算时间不足所致，扩大时间窗纯属浪费 Token，不治本。

5. Go/No-Go
- **结论**：**Go**
- **理由**：
  1) **本质非智力缺陷**：模型的算力已充分达标，可以精准计算出复杂算术答案并落地到文件系统，这证明 baseline 核心通路已经打通，并非模型能力或推理逻辑问题。
  2) **停机协议属于工程性微调**：当前卡在调度器对僵尸进程的处理策略上，通过 OS 层介入拦截 `verifier.passed` 即自动推进状态，或者简单修改 Prompt，皆属于轻量级工程重构。
  3) **短耗时高回报**：该问题修复时长极短（估计仅需 < 1 小时即可全量生效并回归），改动无任何副作用及降级风险，推进实施的 ROI 极高。

根据首席审计架构师的致命问题根因树与高杠杆点分析，针对当前系统面临的“复杂性坍塌”，我为你制定了严格可落地的代码升级计划。本计划不推翻 Top White-Box / Middle Black-Box / Bottom White-Box 的既有拓扑，完全聚焦于增量架构降维。

### 1. Executive Verdict (核心执行论断)
* **抛弃序列无错幻想**：连续长序列执行的成功率在数学上必然收敛于 0，必须通过架构降维（绝对隔离与回滚）来阻断 $O(c^N)$ 错误累积，绝不能用扩大上下文或优化 Prompt 饮鸩止渴。
* **终结上下文坍缩**：追加历史 Trace 导致了严重的系统性失忆。必须实施“上下文绝育”，将系统强制降级为无状态马尔可夫决策机（只输入目标 + 绝对快照）。
* **格式约束硬核化**：不可靠的 Prompt 约束是导致解析中断的根源。必须在底层 API 层级（Oracle）全面实装强制结构化输出（Structured Outputs/Grammar）。
* **强制拆解双脑死锁**：当前的双脑反射（Reflex）面对非确定性边界时直接引发了共识死锁，必须切断辩论循环，引入硬中断（Red Flag）和“独裁者”接管。

---

### 2. Phase Plan (代码升级四阶段)

**Phase 0: 结构化输出硬约束与记忆绝育 (Context Sterilization & Grammar Lock)**
* **Objective**: 彻底消灭 JSON 解析异常，阻断随着步数增加导致的注意力坍缩。
* **Code Changes**:
  * `src/oracle/universal-oracle.ts` -> API 请求层 -> 强行植入 Structured Outputs / JSON Schema 硬解码约束，封闭错误语法概率空间。
  * `src/kernel/scheduler.ts` -> 状态与上下文组装 -> 大面积删除/注释掉向 LLM 追加 `message_history`（历史动作与 Trace）的代码。
  * `src/oracle/turing-bus-adapter.ts` -> Payload 构建 -> 改造为极简无状态马尔可夫输入：`[系统目标] + [当前沙盒绝对状态快照] + [上步单一报错(如有)]`。
* **Recursive Audit Pass Gate**: 连续 100 次 `dispatcher-gate.ts` 无因 JSON/格式解析崩溃；发送给 LLM 的 Context 长度曲线呈绝对水平直线（第 50 步与第 2 步长度等同）。
* **No-Go Triggers**: 仍然出现 `json.loads` 异常；或 LLM 因缺乏记忆在两个毫无意义的动作（如进出同一目录）间无限振荡。
* **Rollback Point**: 撤销 `scheduler.ts` 中针对历史追加逻辑的注释。

**Phase 1: 双脑防死锁与防抖动硬中断 (Dual-Brain Deadlock Break & Anti-Thrashing)**
* **Objective**: 强制拆解 Agent 局部最优死循环，保住全局 `panic_budget`。
* **Code Changes**:
  * `src/oracle/dual-brain-oracle.ts` -> 共识逻辑 -> 临时硬编码 `max_debate_rounds = 0`，遇分歧时强制执行主脑（Leader）决策，剥夺反复反思权。
  * `src/kernel/engine.ts` -> 动作引擎 -> 引入长度为 3 的“历史动作特征 Hash 队列”，实时监控。
  * `src/kernel/engine.ts` & `src/oracle/turing-bus-adapter.ts` -> 如果检测到 `动作A -> 动作B -> 动作A` 循环或连续 2 次触发相同 Error，立刻抛出硬异常。拦截后向 Prompt 强注红旗硬约束：“[SYSTEM RED FLAG] 陷入死循环，严禁重试当前路径”。
* **Recursive Audit Pass Gate**: 跑通 `src/bench/ac42-deadlock-reflex.ts`，验证系统在第二次重复动作时能被瞬间硬中断打断，未耗尽 budget。
* **No-Go Triggers**: Agent 忽略红旗指令继续重试，或正常探索被误判为死循环。
* **Rollback Point**: 移除 `engine.ts` 中的哈希队列拦截机制，恢复 `dual-brain-oracle.ts` 原始辩论轮数。

**Phase 2: 物理级沙盒生命周期重置 (Physical Sandbox Reset)**
* **Objective**: 阻断跨测试间的脏环境与脏状态泄露。
* **Code Changes**:
  * `src/runtime/boot.ts` -> 生命周期控制 -> 为每个测试用例分配独立的 UUID 临时工作区，Case 结束（无论 Pass/Fail）立刻通过 `rm -rf` 等底层命令彻底销毁容器环境与内存栈。
  * `src/runtime/file-execution-contract.ts` -> 预算控制 -> 将 `panic_budget` 的作用域从全局收缩为单个测试的局部独立变量。
* **Recursive Audit Pass Gate**: 执行带有脏数据注入的单测，运行完毕后验证宿主系统与后续测试的初始状态 100% 干净，零残留。
* **No-Go Triggers**: 发现临时 UUID 环境未被销毁，产生越界污染。
* **Rollback Point**: 回退至全局单例工作区模式。

**Phase 3: 微快照与绝对回滚 (Micro-Snapshot & Absolute Rollback)**
* **Objective**: 实现 N-1 状态的安全重试，彻底打破单步误差的级联摧毁。
* **Code Changes**:
  * `src/kernel/engine.ts` -> Syscall 钩子 -> 在每次 `syscall` 执行前触发轻量环境 Snapshot。若动作导致 Error，直接回滚到动作前的绝对干净状态。
  * `src/oracle/universal-oracle.ts` -> 此时将“动作 X 会导致错误 Y”作为前置排雷条件喂给下一次抽样。
* **Recursive Audit Pass Gate**: 故意注入必错 Syscall，验证系统没有在“被弄脏”的环境中瞎试，而是精准回滚并换道探索。
* **No-Go Triggers**: 快照导致的 I/O 性能骤降/假死，或外部 API 调用产生无法回滚的脏副作用。
* **Rollback Point**: 移除 `engine.ts` 的 Snapshot 记录与回滚调用。

---

### 3. Recursive Audit Spec (联合审计执行规范)

调用 `scripts/run_joint_recursive_audit.sh` 模板，执行各阶段刚性门禁：

* **Round N 输入**:
  * `TARGET_DIFF`: 当前阶段涉及的变更文件（如 `universal-oracle.ts`, `scheduler.ts`）。
  * `TEST_GATE`: 对应的验证入口（如 `chaos-monkey-gate`, `ac42-deadlock-reflex`）。
* **Round N 输出** (JSON Audit Report):
  * `parsing_errors_count`: [整数]
  * `context_token_delta_step2_to_50`: [整数]
  * `deadlock_timeout_events`: [整数]
  * `dirty_files_leaked`: [整数]
* **Pass/Fail 硬门禁规则** (只要触碰任意一条，直接阻断下一阶段提交):
  1. `IF parsing_errors_count > 0 THEN FAIL` (格式必须 100% 绝对安全)
  2. `IF context_token_delta_step2_to_50 > 500 THEN FAIL` (上下文必须严格收敛，不准熵增)
  3. `IF deadlock_timeout_events > 0 THEN FAIL` (不允许任何博弈死锁挂起)
  4. `IF dirty_files_leaked > 0 THEN FAIL` (沙盒销毁必须绝对干净)
* **不可逾越法则**：严禁跨 Phase 并行修改。Phase $N$ 未输出 `PASS` 前，绝对禁止启动 Phase $N+1$ 的代码实施。

---

### 4. First 24h Commit Queue (首日最小变更流)

必须严格按照以下拓扑依赖顺序提交（先稳固接口与输入，再破除死锁，最后抓沙盒）：

1. `oracle: enforce strict JSON schema decoding in universal-oracle.ts`
2. `kernel: strip historical trace append logic in scheduler.ts to cap context entropy`
3. `oracle: refactor turing-bus-adapter.ts payload to pure stateless Markov snapshot`
4. `oracle: hardcode max_debate_rounds=0 in dual-brain-oracle.ts to break consensus deadlocks`
5. `kernel: implement length-3 action hash queue in engine.ts for anti-thrashing red flags`
6. `runtime: introduce UUID-based ephemeral workspaces in boot.ts`
7. `runtime: scope panic_budget locally per test in file-execution-contract.ts`

---

### 5. Kill-Switch Validation (物理止损与重构转向)

* **客观触发信号**：
  在完成 Phase 0（上下文绝育）和 Phase 2（硬沙盒物理重置）后，运行 `src/bench/staged-acceptance-recursive.ts`。如果 **48 小时内的基础测试单步通过率依然无法稳定在 70% 以上**，立刻拉动 Kill-Switch。
* **Pivot 行动方案**：
  该信号证明当前的“虚拟终端迭代互动模型”彻底超出了现有 LLM 的认知边界。必须立刻全线冻结当前单体状态机框架的开发，抛弃 `registers.ts` 等所有状态拟真层。
  利用优秀的 `file-execution-contract.ts` 底座，**强制转向“O1 范式生成与编译 (Search & Verify)”模式**：停止让模型“一步步探索”，改为一次性并发生成 100 个完整闭环脚本（Patch），推入 Docker 阵列进行暴力并发过滤，用算力穷举置换序列执行的概率损耗。

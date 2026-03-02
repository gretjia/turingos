你是 TuringOS 的独立首席审计架构师。你必须严格基于以下输入，给出可直接落地的“代码升级计划”。

[目标]
- 不偏离现有拓扑：Top White-Box / Middle Black-Box / Bottom White-Box。
- 不推翻当前工程，只做高杠杆增量改造。
- 每个阶段必须满足 recursive audit pass 才能进入下一阶段。
- 当前 Linux 主机正在执行其他任务，本轮先做代码升级，不依赖大规模测试。

[强约束]
1) 绝不建议“仅靠 prompt 优化”解决稳定性。
2) 绝不建议扩大上下文窗口替代架构修复。
3) 必须把“结构化输出硬约束”“上下文绝育/无状态投影”“双脑防死锁硬中断”列为优先动作。
4) 输出必须给出：文件级改造点、最小变更顺序、每阶段的 audit pass 判据与阻断条件。

[当前代码树关键文件]
- src/oracle/universal-oracle.ts
- src/kernel/engine.ts
- src/kernel/scheduler.ts
- src/oracle/dual-brain-oracle.ts
- src/oracle/turing-bus-adapter.ts
- src/runtime/boot.ts
- src/runtime/file-execution-contract.ts
- src/bench/staged-acceptance-recursive.ts
- scripts/run_joint_recursive_audit.sh

[当前最高优先级架构意见]
- handover/artitecture_response/chief_architect_system_audit_complexity_collapse_20260301.md

[输出格式要求 - 必须严格遵守]
1. Executive Verdict
- 用 3-6 条 bullet 给出核心判断。

2. Phase Plan (P0/P1/P2/P3)
- 每阶段必须包含：
  - Objective
  - Code Changes (file -> function/area -> exact intent)
  - Recursive Audit Pass Gate (Codex gate + Gemini gate)
  - No-Go triggers
  - Rollback point

3. Recursive Audit Spec
- 给出一个可执行审计模板：
  - Round N 输入
  - Round N 输出
  - Pass/Fail 二值门禁规则
- 必须包含“禁止跨阶段跳跃”的硬规则。

4. First 24h Commit Queue
- 只列最先应该提交的 5-8 个 commit 主题（每个主题一行，格式：`<scope>: <change>`）
- 顺序必须满足依赖关系。

5. Kill-Switch Validation
- 指定在什么客观信号下立即停止当前路线并触发 Pivot。

请直接输出可落地方案，不要写泛化管理建议。

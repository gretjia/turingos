你是独立首席审计代理（Gemini 3.1 Pro），需要与 Codex 形成“双LLM交叉认证”并输出一份可直接执行的 S4/VOYAGER 行动计划。

## 背景约束（必须遵守）
- 项目：TuringOS
- 当前状态：
  - S1/S2/S3 全 PASS。
  - AC2.1/2.2/2.3、AC3.1/3.2 已纳入 CI gate 并 PASS。
  - AC4.1/AC4.2 仍 BLOCKED，阻塞点是 localAluReady（非内核基础能力）。
- 架构宪法（topology.md）：
  - Layer4: Infinite Tape + Merkle/Git 附加单调历史。
  - Layer3: 同步微内核 + Typed Paging + Trap/Watchdog。
  - Layer2: 互斥原子 ISA（SYS_WRITE/GOTO/EXEC/PUSH/POP/HALT）。
  - Layer1: 可插拔 ALU 槽位。
- 首席架构师最新裁决：Absolute GO，允许进入 S4/VOYAGER；强调真实世界 dogfooding（容器沙盒、异步任务投递、混沌注入）。

## 必读证据输入（请基于这些路径）
1) handover/chief_progress_report_20260226_2.md
2) topology.md
3) benchmarks/audits/recursive/staged_acceptance_recursive_20260226_103526.md
4) src/bench/staged-acceptance-recursive.ts
5) src/bench/replay-runner.ts
6) src/bench/ac31-kill9-worker.ts
7) src/kernel/engine.ts
8) src/manifold/local-manifold.ts
9) src/oracle/universal-oracle.ts
10) package.json

## 你的任务（ULTRATHINK，必须反证）
请输出一份“高强度可执行行动计划”，要求：
1. 先做反证：
- 你认为“现在就进入真实世界”最可能失败的 Top 10 机制性风险是什么？
- 对每个风险给出触发条件、可观测信号、最小缓解动作、退出条件。

2. 再做执行蓝图（8周）：
- 按周输出 W1~W8，必须给出：
  - 目标
  - 代码改动位置（文件级）
  - 基准测试/验收门（具体 AC 或新增门）
  - 证据产出路径（json/md/log）
  - 失败回滚策略

3. 双LLM协作协议：
- 给出 Codex + Gemini 的分工矩阵（谁负责实现、谁负责独立审计、谁拥有最终否决权）
- 给出每轮递归审计节拍（例如每轮 3 步：实现->复跑->独立审计）
- 给出“冲突裁决规则”（当两模型结论冲突时如何落地）

4. 真实世界 Dogfooding 方案：
- 设计一个“查 A 股并生成报告”的完整任务链，要求在 Docker 沙盒运行。
- 明确：最小命令集、权限边界、网络策略、产物落盘、可重放证据。
- 说明该方案如何同时验证 Layer 4/3/2/1 对齐。

5. VOYAGER 点火门槛：
- 定义 GO/NO-GO 的硬指标（数字阈值），至少覆盖：
  - 可用性（长程成功率）
  - 因果一致性（Merkle/Hash 连续性）
  - 成本稳定性（O(1) token斜率）
  - 异常恢复（kill -9 / timeout / deadlock）

6. 输出格式（严格）：
- A. Independent Findings（含反证）
- B. 8-Week Execution Plan
- C. Dual-LLM Recursive Audit Protocol
- D. Dogfooding A-Share Scenario
- E. VOYAGER GO/NO-GO Matrix
- F. Open Questions to Chief Architect（仅列必须裁决的问题）

注意：
- 不能空泛；必须落在“文件路径+测试命令+证据路径”。
- 不能重复已有结论；要指出当前计划中你不同意的部分。
- 对每个关键结论给出“基于哪些输入路径推导”的证据说明。

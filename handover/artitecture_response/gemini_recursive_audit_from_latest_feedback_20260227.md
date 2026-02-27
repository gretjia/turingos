1. Coverage Check
- 已覆盖: 
  - 长程上下文衰退统计特征（`voyager_realworld_eval.ts` 输出了 `contextStats` 的 min/max/avg/p95）。
  - VLIW 并发密度验证（`engine.ts` 和 `voyager_realworld_eval.ts` 中校验了多指令并发的 bundle 执行情况）。
  - 故障注入的软件层模拟机制（`local-manifold.ts` 支持 `timeout`、`writeDeny`、`logFlood`）。
- 未覆盖: 
  - 任务 A（代码域）：`voyager_realworld_eval.ts` 第 87 行仍在调用 `createSyntheticProject(workspace)` 生成名为 "Kobayashi Maru" 的合成任务，**完全未接入真实活跃开源仓库和 Open Issue**。
  - 强制剥离 `step_file_hint` 护具：`src/kernel/engine.ts` 中仍然存在大量基于 `nextRequiredFileHint` 的硬编码兜底代码（如 `[OS_AUTO_HEAL]` 和 `[OS_AUTO_FIX]`），系统会替 LLM 完成修复，屏蔽了真实的报错。
  - 任务 B（运维域）：系统级级故障（网络、iptables、真实 kill -9）并未实现，目前的 Chaos 仅是本地 FS 拦截和进程启动前 mock。
  - SFT 失败恢复数据收集：当前只保存了全量 Golden/Dirty trace，缺少专门面向 `thrashing`、`panic` 链路提纯输出的 `thrashing.journal` 生成管道。

2. Risks & Gaps
- P0: **核心自欺风险** —— 计划书（`dual_llm_execution_plan...`）中 P0 信誓旦旦写着“禁 mock”，但入口基准测试 `voyager_realworld_eval.ts` 仍在跑 20 个文件的相互 import 合成局。在此基础上跑出来的上下文画像毫无真实业务代表性。
- P1: **自愈验证失效漏洞** —— `engine.ts` 中的 `OS_AUTO_HEAL` 拦截了文本不匹配错误并自动覆盖正确答案。这不仅违背了架构师“强制剥离 hint”的指令，更导致 LLM 无法在真实试错中积累修正轨迹，扼杀了后续提取 SFT 失败-恢复样本的可能性。
- P2: **运维盲盒深度不足** —— `LocalManifold` 中的概率性 Write Deny 和 Exec Timeout 对于验证系统 `panic_budget` 耗尽场景来说太温和，缺乏操作系统级的阻断（真实死锁）。

3. Round 1 Minimal Actions
- Action 1: **代码修改** - 修改 `src/bench/voyager_realworld_eval.ts`，彻底移除 `createSyntheticProject` 函数。通过真实 git 命令 clone 一个指定开源仓库（如特定版本的 node 框架代码），并挂载实际存在过 bug 的代码和单测作为入口。
- Action 2: **破除护具** - 在 `src/kernel/engine.ts` 中，注释或删除包含 `OS_AUTO_HEAL` 和 `OS_AUTO_FIX` 的 if 块段落。强制要求 LLM 在收到 `[OS_TRAP: PLAN_CONTRACT]` 或后续报错后，依靠自身 VLIW 规划去阅读和修复文件。
- Action 3: **新增脚本** - 编写 `src/bench/extract-thrashing-journal.ts`，从 `voyager_realworld_trace_*.jsonl` 中过滤提取带有 `OS_TRAP: THRASHING`、`OS_TRAP: WATCHDOG_NMI` 及 `OS_PANIC` 的事件序列，提纯输出为供 SFT 使用的 `thrashing.journal`。

4. Evidence Paths Required
- path: `benchmarks/audits/longrun/voyager_realworld_eval_latest.json` (必须包含真实克隆 Repo 的证据，不能是 Synthetic)
- path: `benchmarks/audits/longrun/thrashing.journal` (真实报错-触发 TRAP-系统恢复的上下文切片数据)
- path: `benchmarks/audits/longrun/context_decay_profile.json` (或热力图图片，验证在 120+ tick 中上下文膨胀被有效控制)

5. Go/No-Go
- 结论: No-Go
- 理由: 现有的基准代码状态与执行计划所承诺的“真实世界破壁”存在根本性冲突。在底层护具（Auto-Heal）未被剥离、测试集依然是 Synthetic Mock 的情况下，强行启动 Round 1 只会产出极其虚假且存在“回音室效应”的数据，浪费算力。必须先完成上述 Minimal Actions 列表中的代码修正，才能放行后续的长程画像搜集动作。

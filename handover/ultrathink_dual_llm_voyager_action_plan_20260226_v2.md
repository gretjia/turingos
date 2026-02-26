# TuringOS 双LLM行动计划 v2（Cycle 微循环版）

## A. 适用前提（基于当前真实状态）
- 已完成并稳定：S1/S2/S3、AC3.1、AC3.2、Replay Fail-Closed、Golden Trace 入库、S4 trace matrix。
- 当前唯一硬阻塞：`localAluReady=false`（AC4.1 本地 ALU 合格性）。
- 当前阶段目标：在不扩展过大范围的前提下，完成 AC4.1b + AC4.2，并建立 Voyager 预点火最小门。

## B. 联合结论（Codex + Gemini）
- 执行策略从“8周宏计划”收敛为“Cycle N ~ N+3 微循环”。
- 每个 Cycle 必须有：代码改动 -> 复跑 -> Gemini 独立审计 -> 联合裁决。
- 任何 Cycle 出现 `FAIL`，不进入下一 Cycle。

## C. Cycle 计划（只做当前必要项）

## C1. Cycle N（P0-Contract）
- 目标: 固化 S4 治理边界，避免重复争论。
- 改动:
  - `src/bench/staged-acceptance-recursive.ts`
- 任务:
  1. 将 AC4.1 逻辑拆成报告层双指标：
     - `ac41a_traceMatrixReady`
     - `ac41b_localAluReady`
  2. 保持总门不变（未同时达标仍 BLOCKED）。
  3. 报告输出中显式打印两者阈值与当前值。
- 验收命令:
  - `npm run bench:staged-acceptance-recursive`
  - `npm run bench:ci-gates`
- 证据路径:
  - `benchmarks/audits/recursive/staged_acceptance_recursive_<stamp>.md`
  - `benchmarks/audits/recursive/joint_verdict_cycleN_<stamp>.md`
- 回滚:
  - 仅回滚报告字段，不放宽任何 gate。

## C2. Cycle N+1（P1-local ALU Gate）
- 目标: 首次把 `localAluReady` 变成“可测量而非口头指标”。
- 改动:
  - `src/bench/ac41b-local-alu.ts`（新增）
  - `package.json`（新增脚本）
  - `src/oracle/local-oracle.ts`（新增最小适配，先可跑再优化）
- 任务:
  1. 构建 syscall 格式良品率测试（先 N=1000，后续再提升）。
  2. 验证 opcode 合法性 + 字段互斥 + JSON 可解析率。
  3. 输出 `localAluReady` 判定文件。
- 初始阈值（本轮硬编码，避免等待裁决）:
  - `valid_json_rate >= 99.9%`
  - `mutex_violation_rate == 0`
- 验收命令:
  - `npm run bench:ac41b-local-alu`
  - `npm run bench:staged-acceptance-recursive`
- 证据路径:
  - `benchmarks/audits/local_alu/ac41b_<stamp>.md`
  - `benchmarks/audits/evidence/local_alu/<stamp>/`
- 回滚:
  - 若失败，保留 shadow mode，不解锁 S4。

## C3. Cycle N+2（P2-deadlock Reflex）
- 目标: 完成 AC4.2 最小闭环（非理想性能，先达标）。
- 改动:
  - `src/bench/ac42-deadlock-reflex.ts`（新增）
  - `src/kernel/engine.ts`（仅必要修复，如栈空 SYS_POP 保护）
- 任务:
  1. 构造连续 trap 场景。
  2. 断言 3 次 trap 内能进入 `SYS_POP -> SYS_GOTO` 逃逸链。
- 验收命令:
  - `npm run bench:ac42-deadlock-reflex`
  - `npm run bench:staged-acceptance-recursive`
- 初始阈值:
  - `deadlock_escape_rate >= 95%`（N>=500）
- 证据路径:
  - `benchmarks/audits/recursive/ac42_deadlock_reflex_<stamp>.md`
- 回滚:
  - 仅允许 Trap 文案与策略调优，不放松阈值。

## C4. Cycle N+3（P3-Voyager Preflight，最小版）
- 目标: 在进入完整 Voyager 前，只验证“容器隔离 + A股任务链最小可行性”。
- 改动:
  - `src/manifold/docker-manifold.ts`（新增最小实现）
  - `src/bench/voyager-ashare-smoke.ts`（新增）
  - `benchmarks/scenarios/ashare_task.md`（新增）
- 任务:
  1. 容器内执行最小命令集（python/pip/cat/ls）。
  2. 产出 `ashare_report.md`。
  3. 断网 replay，校验哈希一致性。
- 验收命令:
  - `npm run bench:voyager-ashare-smoke`
  - `npm run bench:replay-runner -- --trace <...> --workspace <...>`
- 预点火阈值:
  - `ashare_task_success_rate >= 80%`（短程）
  - `replay_hash_match == 100%`
- 证据路径:
  - `benchmarks/audits/voyager/preflight_<stamp>.md`
  - `benchmarks/audits/evidence/voyager/preflight_<stamp>/`
- 回滚:
  - 若隔离失败，立即停用 docker-manifold 分支，回退到 sandbox-only mock。

## D. 双LLM递归审计协议（强制）
- 每个 Cycle 固定产出三件套：
  1. `codex_impl_cycle_<n>.md`
  2. `gemini_audit_cycle_<n>.md`
  3. `joint_verdict_cycle_<n>.md`
- 冲突规则:
  - Codex=PASS 且 Gemini=FAIL => 总结论 FAIL。
  - 连续 3 轮冲突未收敛 => 升级首席架构师裁决。

## E. 当前轮次的 GO/NO-GO
- GO 条件（进入下一 Cycle）:
  - 本 Cycle 验收命令全绿。
  - Gemini 审计不是 FAIL。
  - 证据文件完整落盘。
- NO-GO 条件:
  - 任何硬门阈值未达标。
  - 缺少证据或证据与报告不一致。

## F. 提请首席裁决（仅保留必要问题）
1. 是否批准将 AC4.1 报告层拆分为 `ac41a` 与 `ac41b`，保持总门不变。
2. 是否批准 `localAluReady` 初始硬阈值采用：`N=1000, valid_json_rate>=99.9%`。
3. 是否批准 Voyager 进入“Preflight最小版”而非直接全量 Chaos。

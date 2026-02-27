# TuringOS 联合工作组（Codex + Gemini）四阶段验收编排

## 目标
按 AC1.1~AC4.2 与 Voyager 试炼建立可执行验收 + 每阶段递归审计流程，并输出双审计证据（Codex + Gemini）。

## 已落地能力

1. 分阶段验收执行器（Codex）
- 文件: `src/bench/staged-acceptance-recursive.ts`
- 命令: `npm run bench:staged-acceptance-recursive`
- 输出:
  - `benchmarks/audits/recursive/staged_acceptance_recursive_<timestamp>.json`
  - `benchmarks/audits/recursive/staged_acceptance_recursive_<timestamp>.md`

2. 联合双审计一键流水线（Codex + Gemini）
- 文件: `scripts/run_joint_recursive_audit.sh`
- 命令: `npm run bench:staged-acceptance-joint`

3. CI 三门禁（本轮新增）
- 新增脚本: `src/bench/ci-gates.ts`
- npm 命令: `npm run bench:ci-gates`
- 强制门禁: `AC2.3`、`AC3.1`、`AC3.2` 必须为 `PASS`，否则 CI 失败。
- 新增工作流: `.github/workflows/acceptance-gates.yml`
  - `npm ci`
  - `npm run typecheck`
  - `npm run bench:staged-acceptance-recursive`
  - `npm run bench:ci-gates`

4. 关键内核/验收修复
- `src/kernel/engine.ts`
  - HALT 门禁收紧为命令级验证信号。
- `src/oracle/universal-oracle.ts`
  - Kimi 无历史帧请求 + telemetry jsonl 采样。
- `src/bench/staged-acceptance-recursive.ts`
  - AC1.1 runtime trap-aware 恢复断言（替代硬编码恢复替身）。
  - AC1.2/AC1.3 运行时断言（替代静态正则）。
  - AC2.3 真实 `TuringEngine` 500 tick 动态分页负载 + 趋势判据（slope/drift）。
  - AC3.1 真实进程级 kill -9 恢复验证。
- 新增 worker: `src/bench/ac31-kill9-worker.ts`

## 最新有效证据（073207 轮）

- Codex 报告:
  - `benchmarks/audits/recursive/staged_acceptance_recursive_20260226_073207.md`
- Gemini 报告:
  - `benchmarks/audits/recursive/staged_acceptance_recursive_gemini_20260226_073207.md`

### 阶段状态（Codex）
- S1: PASS
- S2: PASS
- S3: PASS
- S4: BLOCKED
- VOYAGER: BLOCKED

### Gemini 结论（073207）
- 对 S1/S2/S3 实现给出通过确认。
- 仍建议后续补强 AC2.1 的“整帧最终长度防线”（非本轮 CI 三门禁范围）。

## 本地门禁验证
- 命令: `npm run bench:ci-gates`
- 结果: `AC2.3=PASS`、`AC3.1=PASS`、`AC3.2=PASS`。

## 下一轮递归计划
1. 将 AC2.1 扩展为“最终发给 Oracle 的整帧长度”验收（补全 Gemini 风险点）。
2. 将 kill -9 与 replay 用例纳入常规 CI（可选拆分工作流）。
3. 推进 S4（SFT 管线 + deadlock reflex）与 Voyager（Chaos Monkey）基建。

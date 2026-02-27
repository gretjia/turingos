# TuringOS 进度联合审计报告（Codex + Gemini）

- 日期: 2026-02-27
- 联合审计人: Codex, Gemini
- 审计范围: Phase 7.1 -> 7.3（tiny-split 稳定性、model JSON conformance、oracle 路由）
- 当前主分支提交:
  - `edd2e3e` docs(handover): phase7.3 结果记录
  - `87adf1d` fix(guard): guard-mcu-eval 自动 kimi 路由
  - `d9f12ce` feat(guard): 解析硬化 + repair + prod/dev 阈值分层

## 1. 原始结果（Raw Evidence）

### 1.1 VM 本地 gate 快照

1. `benchmarks/audits/protocol/turing_bus_conformance_latest.json`
- stamp: `20260227_043821`
- pass: `true`

2. `benchmarks/audits/guard/guard_tiny_split_gate_latest.json`
- stamp: `20260227_044348`
- pass: `true`
- 关键断言: `reflex counts train=1, val=1, test=0`
- 关键断言: `guard-mcu-eval(gold) pass=true`, `valid_json_rate=1`

3. `benchmarks/audits/guard/guard_analytics_latest.json`
- stamp: `20260227_043823`
- pass: `true`

### 1.2 Mac 模型矩阵原始结果（按时间线）

路径前缀（Mac）：`/Users/zephryj/work/turingos/`

1. 前态（修复前）
- `benchmarks/audits/sft/guard_mcu_eval_20260227_122659.json`
- model: `qwen2.5:7b` (ollama)
- metrics: `validJsonRate=0.1429`, `reflexExactMatchRate=0`, `deadlockEscapeRate=1`
- pass: `false`

2. 前态（修复前，kimi 端点但未正确路由）
- `benchmarks/audits/sft/guard_mcu_eval_20260227_122738.json`
- model: `kimi-for-coding`
- metrics: `validJsonRate=0`, `reflexExactMatchRate=0`, `deadlockEscapeRate=1`
- pass: `false`

3. 中间态（解析硬化后，qwen）
- `benchmarks/audits/sft/guard_mcu_eval_20260227_124450.json` (prod)
- `benchmarks/audits/sft/guard_mcu_eval_20260227_124533.json` (dev)
- model: `qwen2.5:7b`, oracle=`openai`
- metrics: `validJsonRate=1`, `reflexExactMatchRate=0`, `deadlockEscapeRate=1`
- pass: `prod=false`, `dev=true`

4. 中间态（解析硬化后，kimi 仍失败，暴露路由问题）
- `benchmarks/audits/sft/guard_mcu_eval_20260227_124245.json` (prod)
- `benchmarks/audits/sft/guard_mcu_eval_20260227_124305.json` (dev)
- model: `kimi-for-coding`, oracle 未标识
- metrics: `validJsonRate=0`, `modelFailures=42`, `modelRepairAttempts=42`
- pass: `prod=false`, `dev=false`

5. 后态（加入 kimi 自动路由后）
- `benchmarks/audits/sft/guard_mcu_eval_20260227_124642.json` (prod)
- `benchmarks/audits/sft/guard_mcu_eval_20260227_124750.json` (dev)
- model: `kimi-for-coding`, oracle=`kimi`
- metrics: `validJsonRate=1`, `reflexExactMatchRate=1`, `deadlockEscapeRate=1`
- pass: `prod=true`, `dev=true`

## 2. 需要讨论的代码（含相对路径）

1. `src/oracle/turing-bus-adapter.ts`
- 关键修改区:
  - `asTransitionShape` 别名映射与嵌套提取（约 L160-L201）
  - `collectBalancedObjectCandidates` JSON 候选切片（约 L219-L264）
  - `parseBusTransitionFromText` 多候选去重解析（约 L266-L306）
- 讨论价值:
  - 显著提升噪声输出下解析成功率
  - 可能引入“过宽松匹配”风险（见第 4 节）

2. `src/bench/guard-mcu-eval.ts`
- 关键修改区:
  - 阈值分层 `prod/dev`（约 L107-L131）
  - `oracleMode` 自动识别与覆盖（约 L133-L139, L355-L365）
  - 强约束提示词（约 L287-L314）
  - repair 重试（约 L331-L353）
  - 报告字段扩展（oracle/profile/repair/failures）
- 讨论价值:
  - 把“格式失败”与“策略失败”分离开
  - 让 Kimi 通道正确生效

3. `src/bench/guard-mcu-loop.ts`
- 关键修改区:
  - `--threshold-profile` 参数透传（约 L45-L67, L129-L131）
- 讨论价值:
  - 统一 loop 入口支持 prod/dev 策略

4. `package.json`
- 关键修改区:
  - 新脚本: `bench:guard-mcu-loop:dev`, `bench:guard-mcu-loop:prod`
- 讨论价值:
  - 让环境分层门禁显式化，便于 CI/CD 编排

5. `src/bench/guard-tiny-split-gate.ts`（既有新增）
- tiny 数据回归门：`policy=3`, `reflex=2` 场景强制回归
- 讨论价值:
  - 防止 `val=0` 类退化再次回归

## 3. 联合结论（Codex + Gemini）

1. 结论状态
- Codex: `GO`
- Gemini: `GO`

2. 一致结论
- JSON conformance 问题已被有效收敛（`validJsonRate` 从 `0/0.1429` 提升到 `1.0`）。
- Kimi 通道问题已定位并修复（`oracle=kimi` 后 prod/dev 全绿）。
- 目前剩余短板集中在本地小模型（qwen2.5:7b）的 reflex 行为质量而非格式正确性。

## 4. 争议点 / 风险点 / 疑问

1. 解析器宽松边界是否过大
- 疑问: `asTransitionShape` + balanced-candidate 是否可能误接收“语义不可靠但结构可解析”的输出？
- 影响: 可能提升 validJsonRate 的同时掩盖策略漂移。

2. `reflexExactMatchRate` 仅基于 `op` 是否过粗
- 疑问: 当前 exact 评估以 `predictedOp == expectedOp` 为主，未比较关键参数（如 `SYS_GOTO.pointer`）。
- 影响: 可能高估真实恢复质量。

3. repair 触发观测不足
- 疑问: 当前 `modelRepairAttempts` 统计了次数，但缺少按样本细粒度诊断（哪类 trap/输入最常触发修复）。
- 影响: 难以优化 prompt 和选择模型。

4. dev/prod 阈值差异是否应进一步制度化
- 疑问: dev 放宽是否会被误用为上线准入标准？
- 影响: 需要明确“dev 仅用于联调、不用于发布”的策略边界。

## 5. 下一步理解与规划

1. 提升评估分辨率（优先）
- 在 `guard-mcu-eval` 增加参数级匹配指标（例如 `reflex_param_match_rate`），避免只看 `op`。
- 输出失败样本索引与最小复现片段，支持快速回放调试。

2. 局部强化本地 7B lane（并行）
- 保持 `qwen` 作为 E-lane/低成本模式，但把 prod 门槛与发布策略绑定到 `prod profile`。
- 若目标是本地 prod，可新增模型候选基线（如更大本地模型）并复用同一 gate。

3. 固化发布准入规则（治理）
- 发布准入仅认 `prod` profile pass。
- 将 `oracleMode`、`thresholdProfile`、模型名称写入固定审计产物，确保结果可追溯。

## 6. Gemini 独立意见摘录

- 审计结论: `GO`
- 重点提醒:
  - 本地小模型 `qwen2.5:7b` 的 prod 失败属于“逻辑能力不足”，不是解析问题。
  - prod/dev 差异必须制度化，避免 dev 通过造成错觉。
  - 建议继续做 repair 开销与稳定性压力测试。


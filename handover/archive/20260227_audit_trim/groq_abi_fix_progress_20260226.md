# Groq接入后 ABI 修复进展（2026-02-26）

## 本轮目标
1. 在 `omega-vm` 上对 Groq 小模型做固定基准（3x30）。
2. 针对 `INVALID_OPCODE / MUTEX_VIOLATION` 做最小改动修复。
3. 复跑 staged acceptance，确认无回归。

## 关键改动
- `src/oracle/universal-oracle.ts`
  - `SYS_PUSH` 归一化增强：
    - 接受 `cmd/command` 作为 `task` 别名。
    - 当 `task` 为对象时，序列化为单行 JSON 字符串（保持 ABI 单字段约束）。
  - 保持 fail-closed：仍拒绝未授权字段组合（例如 `SYS_WRITE + pointer`）。

- `src/bench/ac41b-local-alu-eval.ts`
  - 强化 ALU 评估提示词，明确每个 opcode 的“允许字段白名单”。
  - 显式禁止：`pointer in SYS_WRITE`、`payload in SYS_PUSH`。

- `turing_prompt.sh`
  - 同步 BIOS 级 ABI 约束（fail-closed 字段约束）。

## 基准与结果

### A) Groq 固定基准（3x30）
- 首版裸压测：
  - `benchmarks/audits/local_alu/groq_latency_baseline_20260226124728.json`
  - 结果：`ok=31/90`，后两轮被 `429` 限流主导。

- 重试/退避版：
  - `benchmarks/audits/local_alu/groq_latency_baseline_retry_20260226124921.json`
  - 结果：`ok=50/90`，`statusAgg={200:50, 429:196}`。
  - 解释：当前 key 的速率配额是主要瓶颈；模型本身成功请求延迟稳定（~80-90ms）。

### B) ABI 修复前后对比（ac41b-local-alu-eval）
- 修复前：
  - `benchmarks/audits/local_alu/ac41b_local_eval_20260226_123730.json`
  - `successRate=0.6 (12/20)`

- 修复后：
  - `benchmarks/audits/local_alu/ac41b_local_eval_20260226_125005.json`
  - `successRate=1.0 (20/20)`

- 最新门控输入：
  - `benchmarks/audits/local_alu/ac41b_20260226_125113.json`
  - `totalSamples=20, validJsonRate=1, mutexViolationRate=0`

### C) staged acceptance 复跑
- `benchmarks/audits/recursive/staged_acceptance_recursive_20260226_125116.json`
- S1-S3 全绿；S4 仍 BLOCKED（预期内）：
  - AC4.1 阻塞因子：`source=remote_proxy` + `minSamples=1000`（当前只有 20）
  - AC4.2 阻塞因子：`source=mock_reflex_oracle`（非真实 local ALU）

## 当前结论
- Groq 作为“快且便宜”通道成立，但免费/低配额下会被 `429` 限流。
- ABI 失败率已显著下降（ac41b 从 0.6 -> 1.0，20样本）。
- 进入 S4 仍需要：
  1) 提升本地/可认证 ALU 样本量到门槛（>=1000）。
  2) 将 AC4.2 切到真实 source，而非 mock。 

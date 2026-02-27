# TuringOS 递归审计进展汇报（提交首席架构师）

## 1) 本轮结论（执行结果）
- 当前提交：`7e687e7` (`feat: harden replay fail-closed and advance s4 matrix gating`)
- 结论：
  - S1/S2/S3 继续稳定 PASS。
  - AC2.1/AC2.2/AC2.3/AC3.1/AC3.2 在 CI gate 下均 PASS。
  - AC4.1 仍为 BLOCKED，但阻塞原因已收敛为单点：`localAluReady=false`。
  - AC4.1 的混沌矩阵已达标：`traceMatrixReady=true`（exec/timeout/mmu/deadlock/execMmu 全命中）。

## 2) 本轮已落地改造（对应首席裁决）
### A. Replay 全面 Fail-Closed
- 文件：`src/bench/replay-runner.ts`
- 关键实现：
  - 移除 permissive/non-strict 路径。
  - 对 replay tuple 解析和字段缺失直接 `TRACE_CORRUPTION`。
  - `verifyFrameHashes` 与 `verifyMerkleChain` 改为强不变量校验。

### B. 证据链“入库神圣化”
- 文件：`src/bench/staged-acceptance-recursive.ts`
- 关键实现：
  - AC3.1/AC3.2 PASS 后自动归档证据到
    `benchmarks/audits/evidence/golden_traces/<stamp>_ac31_lazarus` 和 `<stamp>_ac32_replay`。
  - 每个 bundle 生成 `manifest.json`，记录 copied files + `sha256`。

### C. S4 解锁矩阵升级
- 文件：`src/bench/staged-acceptance-recursive.ts`
- 关键实现：
  - `collectTraceStats` 新增信号：`mmuSignals`, `deadlockSignals`, `execMmuSignals`, `traceCorrupted`。
  - AC4.1 解锁条件升级为：
    `!traceCorrupted && execOps>=5 && timeoutSignals>=1 && mmuSignals>=1 && deadlockSignals>=1 && execMmuSignals>=1`
  - 状态表达修正：`traceMatrixReady` 与 `localAluReady` 分离，避免“矩阵已达标但仍 BLOCKED”的语义歧义。

### D. AC3.1 worker 注入混沌信号（用于矩阵达标）
- 文件：`src/bench/ac31-kill9-worker.ts`
- 关键实现：
  - 追加 `q4~q10` 序列，产生：
    - `SYS_EXEC` 次数覆盖（execOps）
    - timeout/gateway token
    - MMU/page-fault 信号
    - trap/watchdog 死锁信号
    - exec+MMU coupling 信号

## 3) 审计报告位置（请首席直接核阅）
### 机器验收主报告（最新）
- `benchmarks/audits/recursive/staged_acceptance_recursive_20260226_103526.json`
- `benchmarks/audits/recursive/staged_acceptance_recursive_20260226_103526.md`

### 双LLM递归审计
- `benchmarks/audits/recursive/staged_acceptance_recursive_gemini_20260226_095508_stepA.md`
- `benchmarks/audits/recursive/staged_acceptance_recursive_gemini_20260226_100001_stepB_final.md`
- `benchmarks/audits/recursive/staged_acceptance_recursive_gemini_20260226_103543_stepC_matrix.md`

### Codex 过程审计
- `benchmarks/audits/recursive/staged_acceptance_recursive_codex_20260226_095934_followup.md`

## 4) 证据链位置（Golden Trace）
### AC3.1 Lazarus 证据（最新一轮）
- `benchmarks/audits/evidence/golden_traces/20260226_103526_ac31_lazarus/manifest.json`
- 同目录下：`ac31.journal.log`, `ac31.journal.merkle.jsonl`, `ac31.worker_ticks.log`, `ac31.reg_q`, `ac31.reg_d`, `ac31.resume.txt`

### AC3.2 Replay 证据（最新一轮）
- `benchmarks/audits/evidence/golden_traces/20260226_103526_ac32_replay/manifest.json`
- 同目录下：`ac32.synthetic.journal.log`, `ac32.synthetic.journal.merkle.jsonl`, `ac32.exec_snapshot_trace.jsonl`, `ac32.dirty.journal.log`, `ac32.dirty.journal.merkle.jsonl`

## 5) 关键代码锚点（供首席快速过目）
- `src/bench/replay-runner.ts:96, 165, 229, 247`
- `src/bench/staged-acceptance-recursive.ts:54, 93, 279, 1335, 1346, 1353`
- `src/bench/ac31-kill9-worker.ts:53, 62, 67, 70, 73, 77, 80`

## 6) 当前问题与疑惑（请求首席裁决）
1. **AC4.1 状态建模问题**
   - 现状：`traceMatrixReady=true`，但因 `localAluReady=false` 仍 BLOCKED。
   - 问题：是否将 AC4.1 拆分为 AC4.1a（矩阵就绪）+ AC4.1b（本地7B就绪）以提升治理清晰度？

2. **localAluReady 的“硬标准”未定**
   - 现缺：可执行且可审计的门槛定义（例如最小数据规模、最小json syscall良品率、回放一致性阈值）。
   - 请求：请首席给出 `localAluReady` 的最小达标合同（硬性指标 + 报告格式）。

3. **Golden Trace 保留策略**
   - 现状：每轮都落库，证据增长快。
   - 问题：是否执行“滚动保留策略”（如保留最近 N 轮+里程碑轮）与压缩归档规范？

4. **S4 进入策略（GO 条件）**
   - 现状：矩阵信号已满足，CI 仍只硬门禁到 AC3.2。
   - 问题：是否授权进入 S4 子任务（数据清洗 + SFT pipeline + deadlock reflex harness），并以 AC4.1b 为下一阻断门？

## 7) 请求首席本轮输出
- 请输出：`Verdict (GO/NO-GO)` + `Top-5 Action Plan (按优先级)` + `localAluReady 最小合同`。

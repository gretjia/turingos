# TuringOS Full Context Handover (2026-02-26)

## 1. Snapshot
- Repo: `projects/turingos`
- Branch: `main`
- Latest commit: `e4c4fa8` (`feat: enforce offline replay safety and dirty-trace AC3.2 cross-check`)
- Previous major commit in this phase: `0176d39` (`feat: harden topology-v3 acceptance gates and recursive audit loop`)
- Architecture baseline file: `topology.md`

## 2. What Has Been Implemented

### 2.1 Topology-v3 alignment hardening
1. Engine final-frame hard wall and deterministic section budgeting (protect `OBSERVED_SLICE` under 4096 char cap).
2. Callstack depth bound and rendering adjustment for recent-task visibility.
3. AC2.1 acceptance upgraded from slice-only check to real engine-frame evidence check.

Key code:
- `src/kernel/engine.ts`
- `src/manifold/local-manifold.ts`
- `src/bench/staged-acceptance-recursive.ts`

### 2.2 Acceptance + CI gates pipeline
1. Staged acceptance harness available and used as primary gate source.
2. CI gate script enforces required ACs (`AC2.3`, `AC3.1`, `AC3.2`).
3. GitHub Actions workflow runs typecheck + staged acceptance + gate check and uploads artifacts.

Key code/config:
- `src/bench/ci-gates.ts`
- `.github/workflows/acceptance-gates.yml`
- `package.json` (`bench:staged-acceptance-recursive`, `bench:ci-gates`)

### 2.3 AC3.2 dirty-trace and replay safety upgrade
1. `AC3.2` now validates both:
   - synthetic replay consistency
   - dirty replay consistency (trace from AC3.1 kill-9 workflow)
2. Added mutation-guard subtest in AC3.2 (`SYS_EXEC echo 123 > mutation.txt`) that must be blocked in offline replay.
3. `replay-runner` now strictly offline for `SYS_EXEC` (no host command execution); mutating patterns trigger hard failure.

Key code:
- `src/bench/replay-runner.ts`
- `src/bench/staged-acceptance-recursive.ts`
- `src/bench/ac31-kill9-worker.ts`

## 3. Current Verified Test Status

Latest staged acceptance report:
- `benchmarks/audits/recursive/staged_acceptance_recursive_20260226_074913.json`
- `benchmarks/audits/recursive/staged_acceptance_recursive_20260226_074913.md`

Summary in latest report:
- S1: PASS (4/4)
- S2: PASS (3/3)
- S3: PASS (2/2)
- S4: PARTIAL (BLOCKED by missing SFT pipeline/harness)
- VOYAGER: PARTIAL (BLOCKED by missing chaos harness + benchmark pack)

Key AC results in latest report:
- `AC2.1`: PASS (frame hardwall + observed source visibility)
- `AC2.3`: PASS (500-tick O(1) telemetry trend)
- `AC3.1`: PASS (process-level kill-9 resume)
- `AC3.2`: PASS (synthetic + dirty replay hash match + mutating `SYS_EXEC` guard hit)

CI gate status:
- Command: `npm run bench:ci-gates`
- Required gates: `AC2.3`, `AC3.1`, `AC3.2`
- Latest local run: PASS

## 4. Recursive Audit Trail (Gemini)

### 4.1 AC2.1 chain
- NO-GO (found false positive):
  - `benchmarks/audits/recursive/staged_acceptance_recursive_gemini_20260226_073840.md`
- GO (after frame budgeting + AC2.1 tightening):
  - `benchmarks/audits/recursive/staged_acceptance_recursive_gemini_20260226_074205.md`

### 4.2 AC3.2 chain
- NO-GO (found replay SYS_EXEC re-exec risk):
  - `benchmarks/audits/recursive/staged_acceptance_recursive_gemini_20260226_074703.md`
- GO (after strict offline replay + mutation guard test):
  - `benchmarks/audits/recursive/staged_acceptance_recursive_gemini_20260226_074913.md`

## 5. Key Code Index (for Architect Fast Review)

Architecture/ISA:
- `src/kernel/types.ts`

Microkernel frame control:
- `src/kernel/engine.ts`

Manifold paging/callstack:
- `src/manifold/local-manifold.ts`

Oracle retry/telemetry:
- `src/oracle/universal-oracle.ts`

Acceptance harness:
- `src/bench/staged-acceptance-recursive.ts`
- `src/bench/ac31-kill9-worker.ts`
- `src/bench/replay-runner.ts`
- `src/bench/ci-gates.ts`

CI workflow:
- `.github/workflows/acceptance-gates.yml`

## 6. Reproduction Commands

From repo root (`projects/turingos`):
```bash
npm run typecheck
npm run bench:staged-acceptance-recursive
npm run bench:ci-gates
```

Optional joint script:
```bash
npm run bench:staged-acceptance-joint
```

## 7. Open Questions / Items for Chief Architect

1. Offline replay semantics for `SYS_EXEC`:
- Current implementation blocks mutating commands and never re-executes any host command.
- Should target model be:
  - strict no-exec forever, or
  - reconstruct exec effects from tape snapshots (`.journal` / Merkle stream)?

2. Replay correctness depth:
- Today AC3.2 proves tree-hash consistency (synthetic + dirty trace).
- Should we add mandatory validation of replay tuple hashes (`h_q`, `h_s`) and Merkle chain integrity?

3. Gate scope:
- CI hard-gates currently enforce `AC2.3`, `AC3.1`, `AC3.2` only.
- Should `AC2.1` and `AC2.2` also become required gates?

4. Budget constants in `engine.ts`:
- Section caps are engineering constants (contract/L1/callstack/observed budget split).
- Need formal policy from architecture side: fixed constants, adaptive budgeting, or provable upper bounds.

5. S4/VOYAGER unblock criteria:
- Need clear minimum executable spec for:
  - trace-to-SFT dataset pipeline
  - deadlock reflex benchmark harness
  - chaos monkey + long-horizon target benchmark pack

## 8. Historical Context (Needs Revalidation if used externally)

The team discussed earlier A/B observations involving `turingclaw` vs `turingos` behavior in long-run tasks. Those statements exist in conversation history, but this handover focuses on code+evidence currently present in `turingos` repository. Any external comparison claims should be re-run under the same benchmark harness before formal publication.

## 9. Ready-to-send Architect Audit Prompt

Use this prompt directly for chief-architect review:

```md
你是首席架构师，请对 `turingos` 做一次“独立、可追溯、可裁决”的递归审计。

审计目标：
1. 判断当前实现是否与 `topology.md` 对齐（特别是 Layer 4/3/2）。
2. 判断 AC2.1、AC3.1、AC3.2 的证据是否可信，是否存在假阳性。
3. 对下一阶段（S4/VOYAGER）给出 Go/No-Go 结论与优先级。

审计基线：
1. 当前提交：`e4c4fa8`
2. 对比提交：`0176d39`
3. 架构基线文档：`topology.md`

关键审计报告位置：
- `benchmarks/audits/recursive/staged_acceptance_recursive_20260226_074913.json`
- `benchmarks/audits/recursive/staged_acceptance_recursive_20260226_074913.md`
- `benchmarks/audits/recursive/staged_acceptance_recursive_gemini_20260226_073840.md`
- `benchmarks/audits/recursive/staged_acceptance_recursive_gemini_20260226_074205.md`
- `benchmarks/audits/recursive/staged_acceptance_recursive_gemini_20260226_074703.md`
- `benchmarks/audits/recursive/staged_acceptance_recursive_gemini_20260226_074913.md`

关键代码位置：
- `src/kernel/types.ts`
- `src/kernel/engine.ts`
- `src/manifold/local-manifold.ts`
- `src/bench/staged-acceptance-recursive.ts`
- `src/bench/replay-runner.ts`
- `src/bench/ci-gates.ts`
- `src/oracle/universal-oracle.ts`
- `.github/workflows/acceptance-gates.yml`

请重点回答：
1. `SYS_EXEC` 离线重放语义是否符合 Layer 4 预期？
2. AC3.2 是否已足够证明确定性重放，是否还需 Merkle/tuple hash 强校验？
3. CI 必须门禁的 AC 最小集合应是什么？
4. S4/VOYAGER 的最小解锁条件是什么？

输出格式：
1. Verdict: GO / NO-GO
2. Findings: 按严重级别排序，每条附证据路径
3. Acceptance Trust: 分别评估 AC2.1/AC3.1/AC3.2
4. Architecture Alignment: 按 Layer 4/3/2/1 判定
5. Top-5 Action Plan: 每条指定修改文件
6. Unknowns: 仍需补充的数据
```

## 10. Chief Directive Execution Update (Post `e4c4fa8`)

针对首席架构师最新 5 条指令，本轮已完成并通过分步递归审计：

### 10.1 Directive #1: Replay 语义改造（阻断 -> 快照注入）
- `engine.ts` 的 `REPLAY_TUPLE` 扩展为包含：`q_t`, `s_t`, `observed_slice`, `h_q`, `h_s`, `leaf_hash`, `prev_merkle_root`, `merkle_root`。
- `replay-runner.ts` 对 `SYS_EXEC` 改为离线不执行宿主命令，仅沿着指针推进，并要求命令帧存在历史快照（`observed_slice`/`s_t`）。
- `FileChronos.readReplayCursor()` + `TuringEngine.ensureReplayCursorLoaded()` 实现 kill-9 重启后的 replay merkle/tick 续接。

### 10.2 Directive #2: AC3.2 强制 Merkle + h_q/h_s 校验
- `replay-runner.ts` 实施逐 tick `h_q`/`h_s` 校验。
- `replay-runner.ts` 实施逐 tick merkle 链校验（`prev -> leaf -> root`）。
- `replay-runner.ts` 新增 fail-closed：对 `[REPLAY_TUPLE]` 缺关键字段直接抛 `TRACE_CORRUPTION`。
- `staged-acceptance-recursive.ts` 的 AC3.2 现要求 synthetic 与 dirty 两路回放均通过：
  - tree hash 一致
  - `qsHashVerified=true`
  - `merkleVerified=true`
  - `continuityVerified=true`

### 10.3 Directive #3: CI 门禁升级
- `ci-gates.ts` REQUIRED_GATES 已升级为：
  - `AC2.1`, `AC2.2`, `AC2.3`, `AC3.1`, `AC3.2`
- Workflow 已同步：`.github/workflows/acceptance-gates.yml`

### 10.4 Directive #4: 动态预算代数替代魔法数字
- `engine.ts` 增加动态预算公式：
  - `Budget_obs = f(Max_ALU, len(ROM), len(q_t), Margin_safe)`
- 核心入口：`computeOracleFrameBudget(q_t)`
- `composeOracleFrame(...)` 改为基于动态预算分配 contract/l1/callstack/observed。

### 10.5 Directive #5: S4 解锁条件显式门
- `AC4.1` 仍 `BLOCKED`，并显式输出解锁条件统计：
  - `execOps >= 5`
  - `timeoutSignals >= 1` (429/502/timeout)
- 当前最新结果：`execOps=1`, `timeoutSignals=0`, `unlockReady=false`。

## 11. New Evidence (This Round)

### 11.1 Latest staged acceptance reports
- `benchmarks/audits/recursive/staged_acceptance_recursive_20260226_091121.json`
- `benchmarks/audits/recursive/staged_acceptance_recursive_20260226_091244.json`
- `benchmarks/audits/recursive/staged_acceptance_recursive_20260226_091612.json`
- `benchmarks/audits/recursive/staged_acceptance_recursive_20260226_091821.json`
- `benchmarks/audits/recursive/staged_acceptance_recursive_20260226_092223.json`

### 11.2 Recursive audits (Gemini)
- Step-1 (P0 replay+hash/merkle):
  - `benchmarks/audits/recursive/staged_acceptance_recursive_gemini_20260226_091244_step1.md`
- Step-2 (CI gate hardening):
  - `benchmarks/audits/recursive/staged_acceptance_recursive_gemini_20260226_091244_step2.md`
- Step-3 (dynamic budget algebra):
  - `benchmarks/audits/recursive/staged_acceptance_recursive_gemini_20260226_091612_step3.md`
- Step-4 (S4 unlock gate codification):
  - `benchmarks/audits/recursive/staged_acceptance_recursive_gemini_20260226_091821_step4.md`
- Final pass audit (overall alignment verdict):
  - `benchmarks/audits/recursive/staged_acceptance_recursive_gemini_20260226_092223_final.md`

## 12. Current Status Summary
- S1/S2/S3 gate set: PASS
- CI hard blocking: PASS (`AC2.1/2.2/2.3/3.1/3.2`)
- S4 unlock: BLOCKED by policy gate (expected, until real long dirty trace criteria met)
- VOYAGER: still BLOCKED (chaos harness & target pack not yet assembled)

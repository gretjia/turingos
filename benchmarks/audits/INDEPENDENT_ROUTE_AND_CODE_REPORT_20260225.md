# TuringOS 独立证据审计报告（2026-02-25）

## 0. 文档目的
本报告用于提交给外部高级审计师，目标是基于“今天全部测试结果 + 源码证据 + 多轮独立审计结论”，评估当前 TuringOS 代码与路线是否具备继续投入价值。

本报告强调可复核证据，所有关键结论均附原始文件路径。

---

## 1. 证据目录（原始文件）

### 1.1 基准测试原始结果
- 基线（10 repeats）：`/home/zephryj/projects/turingos/benchmarks/results/os-longrun-20260225-064748.json`
- 基线（可读版）：`/home/zephryj/projects/turingos/benchmarks/results/os-longrun-20260225-064748.md`
- 最新（10 repeats）：`/home/zephryj/projects/turingos/benchmarks/results/os-longrun-20260225-081051.json`
- 最新（可读版）：`/home/zephryj/projects/turingos/benchmarks/results/os-longrun-20260225-081051.md`

### 1.2 当天中间迭代结果（同日）
- `/home/zephryj/projects/turingos/benchmarks/results/os-longrun-20260225-074759.json`
- `/home/zephryj/projects/turingos/benchmarks/results/os-longrun-20260225-075139.json`
- `/home/zephryj/projects/turingos/benchmarks/results/os-longrun-20260225-075248.json`
- `/home/zephryj/projects/turingos/benchmarks/results/os-longrun-20260225-075825.json`
- `/home/zephryj/projects/turingos/benchmarks/results/os-longrun-20260225-080629.json`

### 1.3 审计原始文本
- Gemini 根因审计：`/home/zephryj/projects/turingos/benchmarks/audits/gemini_audit_20260225.txt`
- Gemini Go/No-Go（第一次）：`/home/zephryj/projects/turingos/benchmarks/audits/gemini_go_no_go_20260225.txt`
- Gemini Go/No-Go（内联证据复审）：`/home/zephryj/projects/turingos/benchmarks/audits/gemini_go_no_go_inline_20260225.txt`

### 1.4 本报告的数据提取汇总（机器可读）
- `INDEPENDENT_EVIDENCE_SUMMARY_20260225.json`
- 路径：`/home/zephryj/projects/turingos/benchmarks/audits/INDEPENDENT_EVIDENCE_SUMMARY_20260225.json`

---

## 2. 源码关键证据点

### 2.1 架构原则（BIBLE）
- LLM 作为无记忆 ALU，状态放在 `q`，I/O 失败通过 Trap 驱动恢复。
- 证据：`/home/zephryj/projects/turingos/BIBLE.md` 第 12-27 行。

### 2.2 内核执行与 Trap 机制
- 先 `observe` 再进入 Oracle：`engine.ts` 第 42-59 行。
- 进度合约 trap 注入：第 61-89 行。
- HALT 守卫（拒绝 HALT 时走 `sys://trap/halt_guard?details=...`，且保留旧 `q_t`）：第 138-167 行。
- Watchdog：第 170-197 行。
- 对 `sys://append/...` 允许写入：第 199-204 行。
- 证据：`/home/zephryj/projects/turingos/src/kernel/engine.ts`

### 2.3 Manifold 物理接口
- `observe` 对文件不存在直接报错：`local-manifold.ts` 第 34-37 行。
- 新增 `sys://append/<path>`：第 45-74 行。
- 对重复 append 同行触发错误：第 68-70 行。
- system channel 可回显 `details/current_content`：第 102-134 行。
- 证据：`/home/zephryj/projects/turingos/src/manifold/local-manifold.ts`

### 2.4 合约检查器
- `checkProgress()` 仅校验 `DONE` 序列顺序（不验证该步产物内容）：`file-execution-contract.ts` 第 38-67 行。
- `checkHalt()` 最终阶段验证 `required_files` 是否存在：第 69-103 行。
- `readDoneSteps()` 忽略非 `DONE:` 行：第 118-146 行。
- 证据：`/home/zephryj/projects/turingos/src/runtime/file-execution-contract.ts`

### 2.5 评测判定口径
- `plan_adherence` 由 `progress.log` 中 `DONE:<STEP_ID>` 前缀匹配计算：`os-longrun.ts` 第 416-438 行。
- Trap 计数使用正则全局匹配：第 476-517 行。
- `pass` 条件必须 `completion=1 + plan=1 + halted + no watchdog + ...`：第 520-531 行。
- 证据：`/home/zephryj/projects/turingos/src/bench/os-longrun.ts`

---

## 3. 当天测试时间线（量化）

> 数据来源：`INDEPENDENT_EVIDENCE_SUMMARY_20260225.json`

| result file | runs | passed | avg completion | avg plan | avg drift | avg watchdog/run | repeats |
|---|---:|---:|---:|---:|---:|---:|---:|
| os-longrun-20260225-063530.json | 3 | 0 | 0 | 0 | 0 | 6.0000 | na |
| os-longrun-20260225-064341.json | 3 | 0 | 0 | 0.7341 | 0 | 2.3333 | 1 |
| os-longrun-20260225-064748.json | 30 | 0 | 0 | 0.6222 | 0 | 1.1333 | 10 |
| os-longrun-20260225-074759.json | 3 | 0 | 0 | 0 | 0 | 4.0000 | 1 |
| os-longrun-20260225-075139.json | 3 | 0 | 0 | 0.3453 | 0 | 3.6667 | 1 |
| os-longrun-20260225-075248.json | 3 | 0 | 0 | 1.0000 | 0 | 1.6667 | 1 |
| os-longrun-20260225-075825.json | 3 | 0 | 0 | 0.3809 | 0 | 1.6667 | 1 |
| os-longrun-20260225-080629.json | 3 | 0 | 0 | 0.8889 | 0 | 1.6667 | 1 |
| os-longrun-20260225-081051.json | 30 | 0 | 0.0083 | 0.8413 | 0.0044 | 0.2000 | 10 |

---

## 4. 基线 vs 最新（核心对比）

### 4.1 总体
- 基线（064748）：
  - Passed: `0/30`
  - Avg completion_score: `0`
  - Avg plan_adherence: `0.6222`
  - Avg pointer_drift_rate: `0`
  - Avg WATCHDOG_NMI/run: `1.1333`
- 最新（081051）：
  - Passed: `0/30`
  - Avg completion_score: `0.0083`
  - Avg plan_adherence: `0.8413`
  - Avg pointer_drift_rate: `0.0044`
  - Avg WATCHDOG_NMI/run: `0.2`

### 4.2 增量
- Passed: `+0`
- completion_score: `+0.0083`
- plan_adherence: `+0.2191`
- pointer_drift_rate: `+0.0044`
- WATCHDOG_NMI/run: `-0.9333`

解读：
- “计划一致性”和“抗循环性”显著改善。
- “最终产物完成度”和“通过率”基本未改善。

---

## 5. 分场景对比（基线→最新）

### 5.1 pipeline_ordered_execution
- plan: `0.6143 -> 0.8429`
- completion: `0 -> 0`
- watchdog: `1.9 -> 0.3`

### 5.2 fault_recovery_resume
- plan: `0.5857 -> 0.9143`
- completion: `0 -> 0.025`
- watchdog: `1.3 -> 0.1`
- drift: `0 -> 0.0096`

### 5.3 long_checklist_stability
- plan: `0.6667 -> 0.7667`
- completion: `0 -> 0`
- watchdog: `0.2 -> 0.2`
- drift: `0 -> 0.0035`

---

## 6. 失败分布证据（最新 081051）

### 6.1 fileChecks 失败原因
- missing file: `150`
- text mismatch: `38`
- json mismatch on key scenario: `1`

### 6.2 高频失败项（Top）
- `fault_recovery_resume::outputs/count.txt::missing file` ×10
- `fault_recovery_resume::result/RESULT.json::missing file` ×10
- `long_checklist_stability::milestones/m05.txt::missing file` ×10
- `long_checklist_stability::milestones/m06.txt::missing file` ×10
- `long_checklist_stability::milestones/m07.txt::missing file` ×10
- `long_checklist_stability::milestones/m08.txt::missing file` ×10
- `long_checklist_stability::milestones/sequence.txt::missing file` ×10
- `long_checklist_stability::result/RESULT.json::missing file` ×10
- `pipeline_ordered_execution::result/RESULT.json::missing file` ×9

### 6.3 Trap 分布（平均每 run）
- 基线：PAGE_FAULT `7.5`，CPU_FAULT `0.0667`，IO_FAULT `0`，WATCHDOG `1.1333`
- 最新：PAGE_FAULT `16.8`，CPU_FAULT `0`，IO_FAULT `0.1333`，WATCHDOG `0.2`

解读：
- 最新版本明显减少了死循环与 CPU 解析故障；
- 但 PAGE_FAULT 负担显著上升（主要集中在 recovery 场景），并未转化为产物完成。

---

## 7. 审计结论汇总（多轮）

### 7.1 审计 #1（根因）
- 文件：`gemini_audit_20260225.txt`
- 结论要点：
  - 指出“Pre-emptive Page Fault Loop”“append 缺失”“HALT_GUARD 状态污染”等问题。
  - 建议：append 通道、合约容错、HALT trap 不污染 q、强化 BIOS。

### 7.2 审计 #2（Go/No-Go 第一次）
- 文件：`gemini_go_no_go_20260225.txt`
- 结论：`GO`，置信度 90。
- 理由：plan 已显著改善，认为存在可修复的确定性内核缺陷。

### 7.3 审计 #3（Go/No-Go 二次内联复审）
- 文件：`gemini_go_no_go_inline_20260225.txt`
- 结论：`NO-GO`，置信度 92。
- 理由：指标改善主要停留在“协议/格式行为”，未转化为任务交付，复杂度收益递减。

### 7.4 审计冲突说明
- 两次 Go/No-Go 结论冲突（GO vs NO-GO）。
- 二次内联复审明确纳入基线与最新报告全文，更强调“结果导向（pass/completion）”而非“过程导向（plan/watchdog）”。

---

## 8. 独立综合判断（供高级审计师复核）

### 8.1 已被证实的正向改进
1. 计划约束执行能力明显增强（`plan_adherence` 上升 0.2191）。
2. 死循环率明显下降（watchdog 大幅下降）。
3. JSON/CPU 层面稳定（CPU_FAULT 降为 0）。

### 8.2 未被解决的核心问题
1. 最终交付产物仍大规模缺失（missing file 150）。
2. `pass` 仍为 0，且两轮 30-run 一致为 0/30。
3. 目前系统更像“流程合规执行器”，而非“产物交付执行器”。
4. recovery 场景下 PAGE_FAULT 压力过高（最新平均 50.4/场景run）。

### 8.3 路线风险
- 高风险信号：过程指标改善但结果指标基本不动，且持续增加内核复杂度。
- 这类模式在 agent engineering 中常见于“proxy metric 被优化，真实目标停滞”。

---

## 9. 建议给高级审计师的重点复核清单

1. 验证 `progress.log` 与真实产物之间是否存在“结构性脱钩”。
2. 检查是否需要将“逐步产物验收”前移到 `checkProgress()`，而不是只在 HALT 校验。
3. 检查 `sys://append` 与 `IO_FAULT` 的交互是否形成新型循环路径。
4. 检查 `computePass` 口径是否过严/过松，是否反映真实目标。
5. 决策是否继续当前 OS 抽象路线，或转向“验证驱动 + 外置状态机”路线。

---

## 10. 可复现实验命令（用于二次审计）

```bash
cd /home/zephryj/projects/turingos
npm run typecheck
npm run bench:os-longrun -- --repeats 10
```

比较基线与最新：
- baseline: `benchmarks/results/os-longrun-20260225-064748.json`
- latest: `benchmarks/results/os-longrun-20260225-081051.json`

---

## 11. 报告产出信息
- 报告文件：`/home/zephryj/projects/turingos/benchmarks/audits/INDEPENDENT_ROUTE_AND_CODE_REPORT_20260225.md`
- 数据汇总：`/home/zephryj/projects/turingos/benchmarks/audits/INDEPENDENT_EVIDENCE_SUMMARY_20260225.json`


# TuringOS 双LLM ULTRATHINK 行动计划（面向首席架构师）

## 0. 审计输入与证据基线
- 架构宪法: `topology.md`
- 最新首席进展汇报: `handover/chief_progress_report_20260226_2.md`
- 最新分段验收: `benchmarks/audits/recursive/staged_acceptance_recursive_20260226_103526.md`
- Golden Trace 证据: `benchmarks/audits/evidence/golden_traces/20260226_103526_ac31_lazarus/`, `benchmarks/audits/evidence/golden_traces/20260226_103526_ac32_replay/`
- Gemini 独立 ULTRATHINK 审计:
  - Prompt: `benchmarks/audits/recursive/ultrathink_gemini_prompt_20260226_111446.md`
  - Response: `benchmarks/audits/recursive/ultrathink_gemini_response_20260226_111446.md`

## 1. 联合裁决（Codex + Gemini）
- 结论: 可以进入 S4/VOYAGER 预点火阶段，但必须先完成 3 个 P0 防线。
- 原因:
  - 已满足: S1/S2/S3 与 AC3.2 强校验回放闭环。
  - 未满足: S4 的 `localAluReady` 与 AC4.2 死锁反射基准尚未落地。
  - 高风险: 真实世界执行层（容器/权限/副作用隔离）尚未形成硬门禁。

## 2. 交叉认证矩阵（共识/分歧）

### 2.1 共识项（立即执行）
1. `replay-runner` 应保持 Fail-Closed，并继续强化格式纯度。
- 证据: `src/bench/replay-runner.ts`
- 行动: 禁止容忍格式漂移；将重放输入格式规范写入 CI。

2. 证据资产必须持续“入库神圣化”。
- 证据: `src/bench/staged-acceptance-recursive.ts`（golden trace bundle）
- 行动: 每轮关键 AC 通过都归档到 `benchmarks/audits/evidence/golden_traces/`。

3. S4 解锁需矩阵化门槛，而非单指标。
- 证据: `staged_acceptance_recursive_20260226_103526.md`（traceMatrixReady=true, localAluReady=false）
- 行动: 保持 `exec/timeout/mmu/deadlock/execMmu` 多信号约束，叠加本地 ALU 良品率。

4. 真实世界测试必须先沙盒化（Docker Manifold）。
- 证据: 当前 `local-manifold.ts` 直接宿主执行 `exec`。
- 行动: 新建容器流形，限制路径、网络、命令面。

### 2.2 分歧项（需首席裁决）
1. Replay 输入是否允许“裸 JSON 行”（非 `[REPLAY_TUPLE]`）
- 现状: 代码允许 `line.startsWith('{')` 解析。
- Codex 观点: 建议迁移为“仅接受 `[REPLAY_TUPLE]`”，减少日志噪声导致的歧义。
- Gemini 观点: 同样主张彻底 fail-closed。

2. `localAluReady` 是否拆分为 AC4.1a/AC4.1b
- Codex 观点: 应拆分，避免“矩阵已达标但总门仍阻塞”的治理歧义。
- Gemini 观点: 同意拆分，有利于审计可解释性。

3. 是否在现阶段引入跨语言 replay verifier
- Codex 观点: 暂缓，不阻塞 S4，先完成本地 ALU + Voyager。
- Gemini 观点: 暂缓可接受，但应预留接口。

## 3. P0-P3 执行路线（8周）

## 3.1 P0（第1周）: 预点火硬门
- 目标: 在进入 S4 训练前，封死重放/执行/证据三条底线。
- 代码改动:
  - `src/bench/replay-runner.ts`
  - `src/bench/ci-gates.ts`
  - `src/bench/staged-acceptance-recursive.ts`
- 任务:
  1. Replay 只接受 `[REPLAY_TUPLE]` 行，禁止裸 JSON 回退。
  2. 新增 `AC4.1a`（trace matrix ready）并纳入报告。
  3. 将 S4 预点火检查脚本化，产出独立审计摘要。
- 验收:
  - `npm run bench:staged-acceptance-recursive`
  - `npm run bench:ci-gates`
- 证据:
  - `benchmarks/audits/recursive/staged_acceptance_recursive_<stamp>.{md,json}`
  - `benchmarks/audits/recursive/s4_prefight_gate_<stamp>.md`
- 回滚:
  - 保留上一版 replay parser，若历史证据不兼容则提供一次性迁移脚本，不放宽解析规则。

## 3.2 P1（第2-3周）: AC4.1b 本地 ALU 就绪
- 目标: 完成本地 7B ALU 推理链路，拿到 syscall 良品率门槛。
- 代码改动:
  - `src/oracle/local-oracle.ts`（新增）
  - `src/bench/sft_dataset_build.ts`（新增）
  - `src/bench/ac41b_local_alu.ts`（新增）
  - `package.json`（新增 bench 命令）
- 任务:
  1. 从 golden traces 抽取 SFT 数据集（合法 syscall, trap 恢复样本）。
  2. 本地模型接入（先推理链路，再考虑微调）。
  3. 构建良品率测试：仅输出合法 ISA opcode + 字段互斥。
- 验收:
  - `npm run bench:ac41b-local-alu`
- 门槛:
  - syscall JSON 合法率 >= 99.9%（N>=10,000）
- 证据:
  - `benchmarks/audits/local_alu/ac41b_<stamp>.md`
  - `benchmarks/audits/evidence/local_alu/<stamp>/`
- 回滚:
  - 低于阈值时不解锁 S4，仍由远程 Oracle 执行，local ALU 只做 shadow mode。

## 3.3 P2（第4周）: AC4.2 死锁反射
- 目标: 在连续 trap 后形成稳定 `SYS_POP -> SYS_GOTO` 逃逸行为。
- 代码改动:
  - `src/bench/ac42-deadlock-reflex.ts`（新增）
  - `src/kernel/engine.ts`（仅在需要时补强栈空保护）
- 任务:
  1. 构建 3 次连续死锁诱导场景。
  2. 记录模型在 trap 后动作分布。
  3. 断言 `SYS_POP` 与路径切换达标。
- 验收:
  - `npm run bench:ac42-deadlock-reflex`
- 门槛:
  - 逃逸成功率 >= 95%（N>=500 回合）
- 证据:
  - `benchmarks/audits/recursive/ac42_deadlock_reflex_<stamp>.md`
- 回滚:
  - 若达不到阈值，增强 trap 提示并回灌训练样本，禁止进入 VOYAGER。

## 3.4 P3（第5-8周）: Docker Dogfooding + VOYAGER Pilot
- 目标: 用真实任务链验证 Layer1-4 对齐并进入 Voyager 小规模点火。
- 代码改动:
  - `src/manifold/docker-manifold.ts`（新增）
  - `benchmarks/scenarios/ashare_task.md`（新增）
  - `src/bench/voyager-ashare.ts`（新增）
  - `src/bench/voyager-chaos.ts`（新增）
- 任务:
  1. 容器侧限制网络白名单与工作目录挂载。
  2. 任务: 抓取 A 股数据并输出 `ashare_report.md`。
  3. 混沌注入: timeout/断网/kill -9/权限陷阱。
- 验收:
  - `npm run bench:voyager-ashare`
  - `npm run bench:voyager-chaos`
- 门槛:
  - 长程成功率 >= 85%
  - replay hash 连续性 = 100%
  - token slope |m| <= 0.15
  - kill -9 恢复率 = 100%
- 证据:
  - `benchmarks/audits/voyager/voyager_pilot_<stamp>.md`
  - `benchmarks/audits/evidence/voyager/<stamp>/`
- 回滚:
  - 任一硬门不达标即回退到 P2，冻结新功能，仅修复内核与流形。

## 4. 双LLM递归审计协议（执行模板）
- 每轮固定三步:
  1. Codex 实现并复跑（生成 `codex_round_<n>.md`）。
  2. Gemini 独立审计（生成 `gemini_round_<n>.md`）。
  3. 差异收敛与裁决（生成 `joint_verdict_round_<n>.md`）。
- 证据目录:
  - `benchmarks/audits/recursive/round_<n>/`
- 冲突处理:
  - 如果 Codex=PASS 且 Gemini=FAIL，默认 FAIL。
  - 连续 3 轮冲突未收敛则升级首席架构师裁决。

## 5. A股 Dogfooding 任务链（最小可行）
1. 输入任务文件: `benchmarks/scenarios/ashare_task.md`
2. 模型动作链（目标）:
- `SYS_EXEC` 安装依赖
- `SYS_WRITE` 生成脚本
- `SYS_EXEC` 执行抓取
- `SYS_WRITE` 写 `ashare_report.md`
- `SYS_HALT`
3. 强制观测:
- 每步 `q_t/s_t/a_t` + `h_q/h_s` + Merkle root 都入 journal。
4. 回放验证:
- 断网运行 replay runner，必须 100% 匹配。

## 6. 本轮需要首席架构师裁决的问题
1. 是否批准 replay 输入改为“只接受 `[REPLAY_TUPLE]` 标准行”。
2. 是否批准 AC4.1 拆分为 AC4.1a（矩阵）/AC4.1b（本地 ALU）。
3. `localAluReady` 的最终门槛是否按 `>=99.9%` 执行，样本规模是否固定为 `N>=10,000`。
4. VOYAGER Pilot 的最低硬门阈值是否采纳本计划第 3.4 节。

## 7. 立即执行清单（下一轮）
1. 落地 P0 三项改造并复跑 staged acceptance。
2. 生成 `round_01` 双LLM递归审计三件套。
3. 提交首席裁决请求并等待阈值确认后进入 P1。

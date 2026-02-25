# TuringOS Codex x Gemini 3.1 Pro 协作工作流

## 0. 目标
在不把 LLM 当内存用的前提下，建立一个可重复的双代理闭环，让 `turingos` 在 OS 长程任务上持续提升两项能力：

1. 长程任务不漂移（目标、子任务、执行路径保持一致）。
2. 最终结果符合计划（有可核查证据，而不是口头结论）。

## 1. 角色分工
`Codex`（实现代理）：
- 负责代码实现、测试执行、结果归档、修复迭代。
- 负责把 Gemini 的审计意见转成最小可验证代码改动。

`Gemini 3.1 Pro Preview`（独立架构顾问 + 审计代理）：
- 负责第一性原理审计、BIBLE 对齐审计、反例攻击设计与复核。
- 负责给出 No-Go 条件和风险排序，不直接改代码。

边界规则：
- Gemini 不直接拥有代码提交权；Codex 不直接跳过审计门禁。
- 任何结论都必须指向源码 diff 或 benchmark 原始结果文件。

## 2. 固定架构约束（每轮必查）
每一轮循环都必须核对以下四项是否仍然成立：

1. `Call Stack Syscall`：任务栈由 OS 托管，LLM 只能 `PUSH/POP/NOP`。
2. `MMU Guard`：超长 I/O 一律截断并带 `[OS_TRAP]`，阻断上下文爆炸。
3. `L1 Trace Cache`：保留最近行为轨迹，识别 A-B-A-B 循环并打断。
4. `thought -> json`：先草稿后 JSON syscall，JSON 合法性强制校验。

## 3. 成功判据（量化）
最低 Go 条件（建议作为当前阶段标准）：

- `longrun_goal_drift_rate = 0%`（目标漂移事件为 0）。
- `plan_adherence >= 90%`（执行步骤与计划一致度）。
- `json_contract_validity = 100%`（无非法 syscall JSON）。
- `deadlock_escape_rate >= 95%`（循环死锁场景可主动脱困）。
- `mmu_overflow_crash = 0`（大日志冲击不导致系统崩溃）。

## 4. 工件与证据协议
每个循环必须写入一个独立目录：

`benchmarks/audits/cycles/<YYYYMMDD_HHMM>_cycle_<NN>/`

最少包含以下文件：
- `00_scope.md`：本轮目标、约束、验收标准。
- `01_gemini_design.md`：Gemini 设计/审计建议原文。
- `02_codex_plan.md`：Codex 实施计划（变更点与风险）。
- `03_diff.patch`：源码改动补丁或 `git diff`。
- `04_test_commands.txt`：执行过的命令清单。
- `05_test_results.md`：原始结果摘要 + 失败样本路径。
- `06_gemini_audit.md`：Gemini 独立复核意见。
- `07_decision.md`：Go/No-Go 决议与下一轮入口条件。

硬性要求：
- 任何“通过/失败”判断，必须带证据文件路径。
- 不允许只给结论不给日志。

## 5. 12 步闭环（设计 -> 讨论 -> 执行 -> 审计）
1. 冻结任务边界：写 `00_scope.md`，明确本轮只改什么。  
通过标准：目标、约束、指标齐全。

2. 建立基线：运行当前版本 benchmark。  
通过标准：有可复现命令和原始输出落盘。

3. Gemini 第一性原理审计：识别失效类型（漂移/爆炸/死锁/恢复失败）。  
通过标准：给出可证伪假设，不允许空泛建议。

4. Codex 产出实施计划：把审计意见映射到具体文件和函数。  
通过标准：每个改动有对应测试条目。

5. Gemini 方案审查：确认计划符合 BIBLE 与约束。  
通过标准：得到“可执行/需修订”结论。

6. Codex 实施最小改动：按计划落地代码。  
通过标准：改动范围与计划一致。

7. 本地静态门禁：`npm run typecheck`、必要构建。  
通过标准：无类型错误。

8. 场景测试门禁：执行长程与崩溃场景测试。  
通过标准：结果文件完整、失败可定位。

9. Gemini 独立审计：不看口头说明，只看代码与证据。  
通过标准：输出严重级别风险列表。

10. Codex 修复高优先级问题：仅针对 P0/P1 回归。  
通过标准：问题复测通过。

11. 回归重跑：复跑同一批测试，比较前后指标。  
通过标准：核心指标净提升或至少不退化。

12. Go/No-Go 决策：形成 `07_decision.md`，进入下一轮或停机重构。  
通过标准：决策依据可追溯到文件证据。

## 6. 标准命令模板
说明：Gemini CLI 模型 ID 使用 `gemini-3.1-pro-preview`。  
`gemini 3.1 pro preview`（带空格）会返回 `ModelNotFound`。

### 6.1 生成 Gemini 设计建议
```bash
gemini -y -m "gemini-3.1-pro-preview" -p "$(cat prompts/gemini_design_prompt.md)" \
  > benchmarks/audits/cycles/<cycle>/01_gemini_design.md
```

### 6.2 生成 Gemini 独立审计
```bash
gemini -y -m "gemini-3.1-pro-preview" -p "$(cat prompts/gemini_audit_prompt.md)" \
  > benchmarks/audits/cycles/<cycle>/06_gemini_audit.md
```

### 6.3 Codex 执行与测试
```bash
npm run typecheck
npm run bench:os-longrun -- --repeats 3
```

## 7. Prompt 模板（可直接复用）
`prompts/gemini_design_prompt.md` 最小模板：

```markdown
你是 TuringOS 外部架构顾问。请基于以下输入给出可执行设计：
1) 本轮目标：<粘贴>
2) 当前失败证据：<粘贴路径与摘要>
3) 代码现状：<粘贴关键文件与函数>

要求：
- 必须按“问题->原因->改动点->验证方式->回滚方式”输出
- 必须覆盖：call stack syscall、MMU guard、trace cache、thought->json
- 结论必须可映射到测试或源码 diff
```

`prompts/gemini_audit_prompt.md` 最小模板：

```markdown
你是独立审计员。只基于证据做判断，不接受主观解释。
输入：
- 代码 diff：<路径>
- 测试结果：<路径>
- 本轮 scope：<路径>

请输出：
1) P0/P1/P2 风险列表（按严重级）
2) 是否通过 Go 门禁（Yes/No）
3) 若 No，必须给出最小修复清单
```

## 8. 72 小时落地节奏
0-12h：
- 固化流程目录、提示词模板、基线跑分与证据留存。

12-24h：
- 第一轮聚焦 `call stack + thought->json`，先保协议稳定性。

24-48h：
- 第二轮聚焦 `MMU guard + trace cache`，压制上下文爆炸与循环死锁。

48-72h：
- 第三轮整合复跑全套 benchmark，完成 Go/No-Go 结论。

## 9. 终止条件（避免无效迭代）
出现以下任意情况，直接 No-Go 并进入重构议程：
- 连续两轮核心指标无提升且无新假设。
- 同类 P0 问题重复出现三次以上。
- 证据链缺失，无法证明改动有效。

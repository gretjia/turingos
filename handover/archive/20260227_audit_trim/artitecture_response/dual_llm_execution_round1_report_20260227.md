# Dual-LLM Round1 执行报告（2026-02-27）

## 输入
- 架构意见：`handover/artitecture_response/chief_architect_latest_feedback_20260227.md`
- Gemini 首轮审计：`handover/artitecture_response/gemini_recursive_audit_from_latest_feedback_20260227.md`

## Codex 落地动作

### A1 真实仓库入口（替换 synthetic）
- 文件：`src/bench/voyager_realworld_eval.ts`
- 变更：
  - 删除 `createSyntheticProject` 入口。
  - 新增 `prepareRealRepoWorkspace`，执行真实 `git clone` + 目标 ref checkout。
  - 新增运行时配置：
    - `VOYAGER_REAL_REPO_URL`
    - `VOYAGER_REAL_REPO_REF`
    - `VOYAGER_REAL_ISSUE_URL`
    - `VOYAGER_REAL_REPO_DIR`
  - 新增 `scenario` 报告字段（repo url/ref/commit/issue/path/entry pointer）。

### A2 关闭内核自动修复护具（默认）
- 文件：`src/kernel/engine.ts`
- 变更：
  - 新增 `TURINGOS_AUTO_REPAIR_ENABLED` 开关，默认关闭。
  - `[OS_AUTO_HEAL]` / `[OS_AUTO_FIX]` 仅在显式开启时生效。

### A3 新增失败轨迹提纯脚本
- 文件：`src/bench/extract-thrashing-journal.ts`
- 能力：
  - 从 longrun trace 中提取 `THRASHING/WATCHDOG/PANIC` 相关事件。
  - 生成：
    - `benchmarks/audits/longrun/thrashing.journal`
    - `benchmarks/audits/longrun/context_decay_profile.json`
- 脚本入口：`package.json` 新增 `bench:extract-thrashing-journal`。

## 本地执行验证
- `npm run -s typecheck`：PASS
- `npm run -s bench:extract-thrashing-journal`：PASS
  - 输出：`thrashing.journal` + `context_decay_profile.json`

## Gemini 复审结论（Round2）
- 文件：`handover/artitecture_response/gemini_recursive_audit_round2_20260227.md`
- 结论：`Go`
- 说明：Round1 三项动作已闭环；下一强制动作是提高 chaos 压力，收集非空 trap/panic 样本用于 SFT。

## 下一步（已对齐 Gemini）
1. 执行高压 sweep，确保 `thrashing.journal` 事件条目 > 50。
2. 产出真实任务 A/B 的首轮死亡日志样本。
3. 基于失败恢复链路构建 SFT 子集并跑对标矩阵。


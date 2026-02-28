# Phase5 Context Degradation Report (2026-02-27)

## Scope

基于 120+ tick 长程轨迹生成上下文衰退热力图，检查：

- 是否满足 O(1) 上下文边界
- 后期是否出现目标遗忘/分页病态
- eviction 是否真实生效

## Source Artifacts

- `../../benchmarks/audits/longrun/context_degradation_heatmap_latest.json`
- `../../benchmarks/audits/longrun/context_degradation_heatmap_latest.md`
- `../../src/chronos/file-chronos.ts`（状态快照来源）

## Observations

- `ticks=124`（input: `voyager_realworld_trace_20260227_133652.jsonl`）
- `context.min=730`, `context.max=3972`, `p95=3350`, `avg=1273.91`
- `clippedRate=0.9597`（119/124）
- `pageLikeRate=0.7177`（89/124）
- `trapLikeRate=0.4839`（60/124）
- `avgMindOpsPerTick=0.863`, `worldOpRate=0.9919`
- 对应 realworld eval：`ticksObserved=124`，满足 `120+` 长程样本要求（`voyager_realworld_eval_20260227_133652.json`）

## Interpretation

1. O(1) 硬边界成立：上下文长度维持在 4K 内，未出现线性膨胀。
2. `120+` tick 目标已达成（124 ticks），可用于后期遗忘与 eviction 的长程分析。
3. 后段仍存在较高 trap/pagination 比例（`trapLikeRate=48.39%`、`pageLikeRate=71.77%`），显示系统仍在异常恢复与翻页巡航间频繁切换。

## Audit Verdict

- 状态：`PASS (for Phase5 deliverable)`
- 原因：架构师要求的 `120+ ticks` 上下文衰退画像已完成，且 O(1) 边界持续成立。
- 备注：本次对应的 `voyager_realworld_eval_20260227_133652.json` 因 chaos 跟随动作为 `SYS_HALT`（非 `SYS_EXEC/GOTO`）导致该单项 gate 失败，但不影响 Phase5 的“长程衰退画像”交付完整性。

## Gap & Next Action

1. 为 `chaos_log_flood_detected_and_followed` 增加策略修复，避免在 flood 后立刻 `SYS_HALT`。
2. 追加“业务有效动作密度”指标（有效写入/测试占比），补强衰退画像解释力。
3. 触发最新 Gemini 终审，基于三大硬交付（Death Trace / Matrix / 120+ Context）给出最终 GO/NO-GO。

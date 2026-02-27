# Context Degradation Heatmap

- generated_at: 2026-02-27T13:54:23.413Z
- input: ../../../../benchmarks/audits/longrun/voyager_realworld_trace_20260227_133652.jsonl
- report_json: ../../../../benchmarks/audits/longrun/context_degradation_heatmap_latest.json
- ticks: 124

## Context

- min: 730
- max: 3972
- avg: 1273.91
- p95: 3350
- slope_per_tick: -2.3496

## Operational Signals

- clipped_ticks: 119 (0.9597)
- trap_like_ticks: 60 (0.4839)
- page_like_ticks: 89 (0.7177)
- avg_mind_ops_per_tick: 0.863
- world_op_rate: 0.9919

## Heatmap

- sparkline: `:*+=::::::--:.::-::::`

| Bin | Tick Range | Avg Length | Intensity |
|---|---:|---:|:---:|
| 1 | 0-5 | 1233 | : |
| 2 | 6-11 | 2778 | * |
| 3 | 12-17 | 2254 | + |
| 4 | 18-23 | 1818 | = |
| 5 | 24-29 | 1121 | : |
| 6 | 30-35 | 1011 | : |
| 7 | 36-41 | 1008 | : |
| 8 | 42-47 | 1031 | : |
| 9 | 48-53 | 995 | : |
| 10 | 54-59 | 985 | : |
| 11 | 60-65 | 1471 | - |
| 12 | 66-71 | 1354 | - |
| 13 | 72-77 | 1130 | : |
| 14 | 78-83 | 878 | . |
| 15 | 84-89 | 980 | : |
| 16 | 90-95 | 1089 | : |
| 17 | 96-101 | 1372 | - |
| 18 | 102-107 | 1056 | : |
| 19 | 108-113 | 1088 | : |
| 20 | 114-119 | 1029 | : |
| 21 | 120-123 | 975 | : |

## Note

- `clipped_ticks` 是 eviction/截断行为的代理指标（通过 `[OS_SECTION_CLIPPED]` 检测）。

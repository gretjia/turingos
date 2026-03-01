# Gemini Answer: Small-Worker Multi-Agent Plan + Four-Slot Status (2026-02-28)

# 结论先行

当前代码库（`src/kernel/` 和 `src/oracle/`）严格实现的是**异构双脑（2槽位）**架构，即 `PLANNER`（规划脑）和 `WORKER`（干脏活脑）。原拓扑中的“形式化验证ALU”和“纠偏单片机MCU”在当前实现里分别被白盒验证器和红旗机制替代，属于“部分保留/缺失但有等价机制”。

## A. 具体多Agents小Workers方案（Gemini）

### 选型标准
- 小Workers：优先格式稳定 + 低延迟 + 低成本 + 高并发（不要求强宏观推理）。
- Planner：优先任务拆解能力 + 长程稳定 + 协议服从（严格使用 `SYS_MAP_REDUCE`）。

### 三层配置
1. 立即可跑（今天）
- Planner: Claude 3.5 Sonnet / GPT-4o
- Worker: Gemini 1.5 Flash / GPT-4o-mini
- 温度: Planner 0.7, Worker 0.0
- 并发: Worker 5-10
- 触发升级: API 成本/限流成为瓶颈

2. 一周优化版
- Planner: DeepSeek R1(API) / Qwen-Max
- Worker: Qwen2.5-Coder-32B / Llama-3.1-8B（本地）
- 温度: Planner 0.6-0.7, Worker 0.0
- 并发: Worker 20+
- 触发降级: Worker 红旗击杀率过高

3. 冲击 1M-step 版
- Planner: o1 / o3-mini / 满血 DeepSeek R1
- Worker: SFT 后专属小模型（Qwen 7B/14B）
- 温度: Planner 0.7, Worker 0.0
- 并发: 高并发
- 触发条件: 已沉淀足够高质量 syscall 轨迹可用于蒸馏

## B. 四槽位是否保留（Gemini）

| 槽位 | 状态 | 证据 | 缺口 | 最小改造建议 |
| --- | --- | --- | --- | --- |
| 深度推理ALU | 保留 | `BrainRole=PLANNER` + Planner温度通道 | 无 | 维持 Planner 只做规划与分解 |
| 极速反射ALU | 保留 | `BrainRole=WORKER` + Worker温度0.0 + Map-Reduce Worker Fork | 无 | 加强并发冲突控制 |
| 形式化验证ALU | 部分保留 | `PENDING_HALT` + `HaltVerifier` 白盒验证 | 不再是LLM槽位 | 保持白盒物理验证，不回退到LLM裁判 |
| 纠偏单片机MCU | 缺失（被机制替代） | `handleRedFlag` + `redFlags>=3` kill/retry | 缺少独立MCU模型 | 可新增轻量 `MCU_ORACLE` 做格式纠偏前置层 |

## 关键判定
- 当前是 **2槽位实现**（Planner + Worker）。
- 四槽位理念中后两槽在现实现中由白盒机制替代，不是独立LLM槽位。

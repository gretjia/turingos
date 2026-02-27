# omega-vm 本地模型 vs 外部API 选型报告（2026-02-26）

## 1) 主机能力结论（omega-vm）
- 平台：Google Compute Engine / Debian 12
- CPU：4 vCPU（Intel Xeon 2.2GHz）
- 内存：15 GiB
- Swap：0
- GPU：无（`nvidia-smi` 不存在）
- 根盘可用空间：约 2.9 GiB

### 对本地推理的含义
1. 无 GPU，推理只能 CPU 跑，吞吐低。
2. 磁盘仅 2.9 GiB 可用，7B 量级 GGUF（常见 Q4）基本不现实（模型文件本身通常接近或超过该空间）。
3. 可以本地跑“超小模型”做协议测试，但不适合你当前 TuringOS 长程任务验收（速度和稳定性都不够）。

## 2) 本地小模型建议（仅用于最小功能验证）
- 建议上限：`0.5B ~ 1.5B` 量级量化模型（CPU-only）。
- 用途：仅验证 JSON syscall 格式、流程连通性、门禁逻辑，不用于性能结论。
- 不建议：把本地 CPU 小模型作为 AC4.x 或 Voyager 的主评估模型。

## 3) 外部 API 选项（快 + 便宜/免费）

## A. Groq（推荐：速度优先）
- 公开价格（gpt-oss-20b）：$0.075/M input，$0.30/M output
- 公开速度：约 1000 TPS（模型卡页和定价页均可见）
- 优点：速度非常高，OpenAI 兼容接口接入简单。
- 适用：你现在要高频循环跑 gate/benchmark，优先稳定吞吐。
- 官方：
  - https://groq.com/pricing
  - https://console.groq.com/docs/model/openai/gpt-oss-20b

## B. Together（推荐：成本优先）
- gpt-oss-20b：$0.05/M input，$0.20/M output（比 Groq 更低）
- 超低价模型示例：Gemma 3n E4B $0.02/M input，$0.04/M output
- 注意：Together 当前无免费试用，需最少 $5 充值。
- 适用：预算敏感但仍要跑可观规模请求。
- 官方：
  - https://www.together.ai/pricing
  - https://docs.together.ai/docs/billing-credits
  - https://support.together.ai/articles/1862638756-changes-to-free-tier-and-billing-july-2025

## C. Cerebras（推荐：免费高速试跑）
- 官方提供 Free 层，且强调“极高速推理”；文档显示 OpenAI 兼容，baseURL 为 `https://api.cerebras.ai/v1`。
- 模型页示例（Llama 3.1 8B）给出 Free tier 速率/配额（如 30 RPM、60k TPM、1M daily tokens）。
- 适用：先低成本/免费验证“速度是否满足你工作流”。
- 官方：
  - https://www.cerebras.ai/pricing
  - https://inference-docs.cerebras.ai/resources/openai
  - https://inference-docs.cerebras.ai/models/llama-31-8b

## D. OpenRouter（推荐：零成本兜底）
- Free 计划可用 25+ free 模型，50 req/day；付费后 free 模型日限可提高。
- 优点：聚合多供应商、切换快。
- 缺点：免费额度太小，不适合你的长程压力测试。
- 官方：
  - https://openrouter.ai/pricing
  - https://openrouter.ai/docs/faq
  - https://openrouter.ai/docs/guides/routing/model-variants/free

## E. NVIDIA（你提到的方案）
- NVIDIA Developer Program 对 NIM API 端点提供“原型开发免费访问”。
- 适合：注册后做原型验证、模型体验。
- 注意：自托管 NIM 需要 NVIDIA CUDA GPU；当前 omega-vm 无 GPU，不能本机 self-host NIM。
- 官方：
  - https://docs.api.nvidia.com/nim/docs/product
  - https://docs.api.nvidia.com/nim/reference/llm-apis
  - https://docs.api.nvidia.com/nim/docs/api-quickstart

## 4) 结论（给你可执行决策）
- 本地：不建议作为主线（硬件不匹配）。
- 主推荐（现在就上）：
  1. **Groq llama-3.1-8b-instant**：实测延迟最低，最适合高频递归测试。
  2. **Groq openai/gpt-oss-20b**：更强但更慢，适合作为二线验证模型。
  3. **Together gpt-oss-20b / Gemma 3n E4B**：预算更低的备选。
  4. **Cerebras Free**：先做零成本高速试跑，确认吞吐后再决定长期供应商。
- NVIDIA：值得注册做原型，但在你这台机器上不能走本地 NIM 自托管。

## 5) 对 TuringOS 的接入建议（最小改动）
你当前 `UniversalOracle('openai', { baseURL, apiKey, model })` 已是 OpenAI 兼容路径。
只需切换环境变量即可：

```bash
# 例：Groq
export OPENAI_API_KEY="<YOUR_GROQ_KEY>"
export TURINGOS_API_BASE_URL="https://api.groq.com/openai/v1"
export TURINGOS_MODEL="openai/gpt-oss-20b"

# 例：Together
# export OPENAI_API_KEY="<YOUR_TOGETHER_KEY>"
# export TURINGOS_API_BASE_URL="https://api.together.xyz/v1"
# export TURINGOS_MODEL="gpt-oss-20b"

# 例：Cerebras
# export OPENAI_API_KEY="<YOUR_CEREBRAS_KEY>"
# export TURINGOS_API_BASE_URL="https://api.cerebras.ai/v1"
# export TURINGOS_MODEL="llama3.1-8b"

npm run bench:staged-acceptance-recursive
```

## 6) 当前状态（已更新）
- 你已提供 Groq key，已写入本地 `.env`（`.gitignore` 已忽略 `.env`）。
- 已完成 Groq 连通、模型枚举、延迟实测与 TuringOS 运行联调。

## 7) Groq 真实实测结果（2026-02-26）

### 7.1 可用模型（节选）
- `llama-3.1-8b-instant`
- `openai/gpt-oss-20b`
- `openai/gpt-oss-120b`
- `moonshotai/kimi-k2-instruct`
- `meta-llama/llama-4-scout-17b-16e-instruct`

### 7.2 同 prompt 延迟对比（8 次采样）
- `llama-3.1-8b-instant`：
  - avg `71.5ms`, p50 `54ms`, p95 `60ms`, min `51ms`, max `192ms`, 8/8 成功
- `openai/gpt-oss-20b`：
  - avg `275.9ms`, p50 `151ms`, p95 `611ms`, min `86ms`, max `663ms`, 8/8 成功
- `groq/compound-mini`：
  - avg `336.0ms`, p50 `272ms`, p95 `484ms`, min `222ms`, max `560ms`, 8/8 成功

结论：在“速度优先+低成本”目标下，当前主力应选 `llama-3.1-8b-instant`。

### 7.3 与 TuringOS 框架联调结果
- `runtime/boot`（全新 workspace, `--oracle openai`, `model=llama-3.1-8b-instant`）可正常走 API。
- 在严格 ISA/ABI 下出现多次 `CPU_FAULT: INVALID_OPCODE`，说明：
  1. 通路可用；
  2. 当前瓶颈是“模型对严格 syscall 输出契约的服从率”，不是 API 可用性或速度。
- `bench:ac41b-local-alu-eval`（20 条样本）结果：`successRate=0.6`（12/20）。

建议：继续保留 Groq 作为主供应商，同时优先推进“输出契约微调/守卫模型”而不是更换 API 供应商。

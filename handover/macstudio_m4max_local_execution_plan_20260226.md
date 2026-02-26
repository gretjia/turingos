# Mac Studio M4 Max 本地执行方案（2026-02-26）

## 目标
将 `turingos` 从 `omega-vm` 迁回你本地 Mac Studio（M4 Max 32GB）进行 `local_alu` 验收，满足 S4 门禁对 `source=local_alu` 的要求。

## 为什么要本地执行
- 当前 S4 门禁硬条件：
  - AC4.1 需要 `source === local_alu`
  - AC4.2 需要 `source` 以 `local_alu` 开头
- 远端 API 在当前代码中会被标记为 `remote_proxy`，无法解锁 S4。

## 硬件适配结论（你的机器）
- Mac Studio M4 Max 32GB 可作为本地主测节点。
- 推荐主测模型（按优先级）：
  1. `qwen2.5:14b-instruct`
  2. `llama3.1:8b-instruct`
  3. `qwen2.5:7b-instruct`（更快，先打通）

## 一次性准备

### 1) 拉取最新代码
```bash
cd /path/to/turingos
git pull origin main
```

### 2) 安装本地推理服务（推荐 Ollama）
```bash
brew install ollama
brew services start ollama
```

### 3) 拉取模型
```bash
ollama pull qwen2.5:14b-instruct
# 备选
# ollama pull llama3.1:8b-instruct
# ollama pull qwen2.5:7b-instruct
```

### 4) 验证 OpenAI 兼容端点
```bash
curl -s http://localhost:11434/v1/models | jq '.data[].id'
```

## 本地环境变量（只在本机，不提交）
在项目根目录 `.env` 中设置：
```bash
TURINGOS_ORACLE=openai
OPENAI_API_KEY=dummy-local-key
TURINGOS_API_BASE_URL=http://localhost:11434/v1
TURINGOS_MODEL=qwen2.5:14b-instruct
```

## 执行顺序（严格按顺序）

### Step A: 生成/刷新数据集
```bash
npm run bench:ac41b-build-trace-dataset || true
```
说明：该脚本即使返回非 0，也会写出报告与数据集，属于预期行为之一。

### Step B: 本地 ALU 评估（先 200 样本冒烟）
```bash
DATASET=$(node -e "const j=require('./benchmarks/audits/local_alu/ac41b_dataset_latest.json');process.stdout.write(j.output)")
npm run bench:ac41b-local-alu-eval -- --dataset "$DATASET" --base-url http://localhost:11434/v1 --model qwen2.5:14b-instruct --limit 200
```

### Step C: 回灌 AC4.1b 门控输入
```bash
LATEST=$(ls -t benchmarks/audits/local_alu/ac41b_local_eval_outputs_*.jsonl | head -n1)
npm run bench:ac41b-local-alu -- --input "$LATEST" --source local_alu
```

### Step D: 全量 staged 验收
```bash
npm run bench:staged-acceptance-recursive
npm run bench:ci-gates
```

### Step E: 目标门槛（你需要盯的指标）
- AC4.1：
  - `ac41b_source=local_alu`
  - `ac41b_totalSamples >= 1000`
  - `ac41b_validJsonRate >= 0.999`
  - `ac41b_mutexViolationRate <= 0`
- AC4.2：
  - `sourceEligible=true`（即 local_alu 来源）

## 失败时的优先排查
1. `source=remote_proxy`：
   - 检查 `--base-url` 是否是 `http://localhost...`
2. 样本不足（<1000）：
   - 提升 `--limit`，多跑几轮并汇总
3. `INVALID_OPCODE/MUTEX_VIOLATION`：
   - 优先换 `qwen2.5:14b-instruct`
   - 降低并发，保持 `temperature=0`
4. 速度慢：
   - 先用 `qwen2.5:7b-instruct` 打通流程，再回到 14b

## 证据回传（审计必需）
执行结束后请保留并提交以下目录：
- `benchmarks/audits/local_alu/`
- `benchmarks/audits/recursive/`
- `benchmarks/audits/evidence/golden_traces/`

## 安全提醒
你之前公开过外部 API key（Groq），请在供应商后台立即轮换。Mac 本地执行阶段优先使用本地 `localhost` 推理，不依赖外部 key。

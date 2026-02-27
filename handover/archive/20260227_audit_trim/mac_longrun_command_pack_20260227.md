# Mac Longrun Command Pack (Topology v4 Dispatcher Integration)

Run these on Mac in:

```bash
cd /Users/zephryj/work/turingos
```

## 1) Sync + install

```bash
git fetch origin
git pull --ff-only origin main
npm ci
```

## 2) Dispatcher + local LLM baseline

```bash
export TURINGOS_ORACLE=openai
export OPENAI_API_KEY=local
export TURINGOS_API_BASE_URL=http://127.0.0.1:11434/v1
export TURINGOS_DISPATCHER_ENABLED=1

export TURINGOS_DISPATCHER_E_ORACLE=openai
export TURINGOS_DISPATCHER_E_MODEL=qwen2.5:7b
export TURINGOS_DISPATCHER_E_BASE_URL=http://127.0.0.1:11434/v1
export TURINGOS_DISPATCHER_E_API_KEY=local

export TURINGOS_DISPATCHER_P_ORACLE=openai
export TURINGOS_DISPATCHER_P_MODEL=qwen2.5:7b
export TURINGOS_DISPATCHER_P_BASE_URL=http://127.0.0.1:11434/v1
export TURINGOS_DISPATCHER_P_API_KEY=local
```

## 3) Gates

```bash
npm run typecheck
npm run bench:dispatcher-gate
npm run bench:guard-analytics
npm run bench:ci-gates
```

## 4) Week4 long-run integration

```bash
npm run bench:longrun-dispatcher-soak
npm run bench:os-longrun -- --oracle openai --dispatcher 1 --scenario pipeline_ordered_execution --repeats 1
```

## 5) Artifacts to check

```bash
ls -lt benchmarks/audits/longrun | head
ls -lt benchmarks/audits/guard | head
ls -lt benchmarks/audits/protocol | head
ls -lt benchmarks/results | head
```

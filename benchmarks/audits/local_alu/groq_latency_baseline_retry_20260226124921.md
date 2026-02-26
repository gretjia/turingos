# Groq Latency Baseline Retry (3x30)

- model: llama-3.1-8b-instant
- totals: 50/90 success
- statusAgg: {"200":50,"429":196}

## Rounds
- R1: ok=20/30, attempts=68, avg=89.2ms, p95=96ms
- R2: ok=15/30, attempts=89, avg=83.4ms, p95=112ms
- R3: ok=15/30, attempts=89, avg=80.27ms, p95=85ms

# Groq Latency Baseline (3x30)

- provider: groq
- model: llama-3.1-8b-instant
- baseURL: https://api.groq.com/openai/v1
- totals: 31/90 success
- aggregate_avg_of_round_avg_ms: 51.89

## Rounds
- R1: ok=30/30, avg=86ms, p50=77ms, p95=97ms, max=279ms
- R2: ok=0/30, avg=35.77ms, p50=32ms, p95=38ms, max=116ms
- R3: ok=1/30, avg=33.9ms, p50=32ms, p95=35ms, max=75ms

# Kimi API Health Gate

## Check 1
- file: benchmarks/audits/health/kimi_api_health_20260225_122717.txt
- result: success_rate=30%, server5xx=7/10

## Check 2
- file: benchmarks/audits/health/kimi_api_health_recheck_20260225_122756.txt
- result: success_rate=30%, server5xx=7/10

## Gate rule
Normal only if:
- success_rate >= 80%
- server5xx <= 1/10

## Decision
UNSTABLE -> block long-run benchmark continuation for now.

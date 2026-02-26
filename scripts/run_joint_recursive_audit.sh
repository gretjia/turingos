#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AUDIT_DIR="$ROOT_DIR/benchmarks/audits/recursive"

cd "$ROOT_DIR"

echo "[joint-audit] running staged acceptance (codex gate)..."
npm run bench:staged-acceptance-recursive >/tmp/turingos_joint_audit_codex.log
cat /tmp/turingos_joint_audit_codex.log

LATEST_MD="$(ls -t "$AUDIT_DIR"/staged_acceptance_recursive_*.md | head -n 1)"
STAMP="$(basename "$LATEST_MD" .md | sed 's/^staged_acceptance_recursive_//')"
GEMINI_OUT="$AUDIT_DIR/staged_acceptance_recursive_gemini_${STAMP}.md"

echo "[joint-audit] latest codex report: $LATEST_MD"
echo "[joint-audit] running gemini independent review..."
gemini -y -p "你是独立审计员。请审计以下文件，并严格按阶段(S1/S2/S3/S4/VOYAGER)给出递归审计。

审计输入文件：
1) $(realpath --relative-to="$ROOT_DIR" "$LATEST_MD")
2) src/bench/staged-acceptance-recursive.ts
3) src/kernel/engine.ts
4) src/oracle/universal-oracle.ts
5) src/manifold/local-manifold.ts

审计要求：
- 必须逐阶段检查是否满足 AC1.1~AC4.2 与 Voyager 要求。
- 必须指出 Codex 报告中可能的误判（如果有）。
- 必须给出递归修复顺序：第1轮先修什么，第2轮复跑什么。
- 结论必须基于文件证据，不接受主观评价。

输出格式（严格）：
1. Stage Findings
- S1: ...
- S2: ...
- S3: ...
- S4: ...
- VOYAGER: ...
2. Misjudgment Check
- 可能误判: ...
- 修正建议: ...
3. Recursive Fix Plan
- Round 1: ...
- Round 2: ...
- Round 3: ...
4. Go/No-Go
- 结论: Yes/No
- 理由: 引用证据路径
" >"$GEMINI_OUT"

echo "[joint-audit] gemini report: $GEMINI_OUT"

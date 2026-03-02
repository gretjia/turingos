# G0 Validation: Manual GGUF Import Path (2026-03-02)

## Goal

Validate a stable install path for future LLM rollout:

1. Download `.gguf` model file manually (domestic mirror path).
2. Create `Modelfile` with local `FROM`.
3. Import into Ollama via `ollama create`.
4. Run via Ollama API/CLI.

## Result Summary

- Mac: **PASS**
- Windows: **PASS**
- Linux target clarification (2026-03-02):
  - Target Linux host for distributed compute is `linux1-lx` (Tailscale), **not** `omega-vm`.
  - `omega-vm` is controller host (no GPU). Policy: **do not install/deploy Ollama on omega-vm in future tasks**.
  - Current instruction: **do not perform any operation on `linux1-lx` now** (host busy with other tasks).

## Mirror Download Path (recommended)

- ModelScope: `https://modelscope.cn/models`
- HF mirror (if available in your environment): `https://hf-mirror.com`

Download the target `.gguf` file first, then use local import below.

## Standard Import Workflow

```bash
# 1) In model folder, create Modelfile
cat > Modelfile <<'EOF'
FROM ./your-model-file.gguf
EOF

# 2) Import into ollama
ollama create your-model-alias -f Modelfile

# 3) Run
ollama run your-model-alias
```

## Host-specific Notes

### Mac

- Ollama CLI path: `/opt/homebrew/bin/ollama`
- Manual GGUF import test passed with temp alias:
  - `turingos-manual-gguf-test-mac`
- Validation marker:
  - `MAC_GGUF_IMPORT_TEST=PASS`

### Windows

- Ollama is running and serving models, but not in PATH for current SSH shell.
- Actual binary path discovered:
  - `D:\work\turingos_llm\bin\ollama.exe`
- API confirmed local service active:
  - `http://127.0.0.1:11434/api/tags` returned installed models.
- Manual GGUF import test passed with temp alias:
  - `turingos-manual-gguf-test-win`
- Validation marker:
  - `WIN_GGUF_IMPORT_TEST=PASS`

Use full path on Windows if PATH is not set:

```powershell
D:\work\turingos_llm\bin\ollama.exe create your-model-alias -f Modelfile
D:\work\turingos_llm\bin\ollama.exe run your-model-alias
```

### Linux (`linux1-lx`)

- This report does not execute tests on `linux1-lx` due explicit freeze instruction for that host.
- When `linux1-lx` is released from other tasks, run the same Modelfile workflow there.

### Controller (`omega-vm`)

- Role: controller/orchestrator.
- Constraint: no GPU workload placement; no future Ollama install/deploy on this host.

## Operational Recommendation

For future any-model install on Mac/Windows/`linux1-lx`:

1. Prefer mirror/manual GGUF download.
2. Always import with `Modelfile` local `FROM`.
3. Validate with one quick generation call before joining benchmark pool.

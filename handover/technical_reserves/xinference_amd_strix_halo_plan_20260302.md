# Xinference Deployment Plan for AMD Strix Halo (AI Max 395 128G)

## Hardware Revelation
The Windows node is powered by the upcoming AMD Ryzen AI Max+ 395 (Strix Halo APU).
- **Architecture**: Zen 5 CPU + RDNA 3.5 GPU
- **Compute**: 16 cores, 40 Compute Units (Radeon 8060S).
- **Memory**: 128 GB Unified Memory (LPDDR5x).

This is a revolutionary piece of hardware for local LLM inference. 128GB of unified memory allows holding both the 27B Planner model AND massive KV cache for 100+ concurrent 7B Workers on a single machine, bypassing traditional VRAM limits of discrete GPUs.

## Deployment Strategy (ABORTED: NATIVE WINDOWS ISSUES)
The attempt to deploy Xinference natively on Windows to manage the 100-worker swarm failed due to architectural limitations with Python multiprocessing on Windows (XOSCAR `Start sub pool failed, returncode: 120` error). Because Xinference relies heavily on POSIX-style `fork()` semantics which Windows lacks, it cannot reliably spawn model worker instances when using `llama.cpp` or `vLLM` backends outside of WSL2.

## Resolution
We have **reverted to Ollama** on Windows for managing the GGUF models. It is a statically compiled Go/C++ binary that is rock solid on Windows and flawlessly manages the KV cache for the unified memory. 
Ollama is actively running and bound to the Tailscale IP (`100.123.90.25:11434`) so Omega-VM can reach it without hitting Windows loopback policies.
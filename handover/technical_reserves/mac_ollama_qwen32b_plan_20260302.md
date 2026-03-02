# Mac Ollama Qwen32b Plan (2026-03-02)

## Situation
The `Qwen3.5:27b` model could not be loaded on Mac even using the bleeding edge `0.5.11` version of Ollama. It constantly throws `error loading model architecture: unknown model architecture: 'qwen35'`. 

Since the official `llama.cpp` does not support this exact configuration yet via standard distributions without manual intervention, I am falling back to **Option A** as requested by the user.

## Action Plan
1. Removed the old `qwen3.5:27b` and any failing `qwq:32b` models from the Mac `mac-back` host.
2. Disabled the Tailscale exit node (`100.81.234.55`) on Mac specifically for the download because routing traffic through Hong Kong back into ModelScope servers in mainland China was heavily throttling the download speed (from ~11 MB/s down to 200 KB/s).
3. Began downloading `Qwen2.5-Coder-32B-Instruct-GGUF` directly from ModelScope via direct link to `qwen2.5-coder-32b-instruct-q4_k_m.gguf`. 
4. We are creating it locally on Mac using the alias `qwen3-coder:30b` to retain compatibility with our environment variables.
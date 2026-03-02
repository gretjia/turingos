# G0 Hotfix: Mac Planner Ollama Flap (2026-03-02 01:27)

## Incident

- Symptom: Mac planner had prior smoke success, then later failed repeatedly during baseline.
- Direct failure signature (case `001117`):
  - `Error: 500 unable to load model: .../sha256-7935...`

## Root Cause (confirmed)

1. Mac had duplicate Ollama serve topology in earlier state (manual + service path mismatch), causing non-deterministic endpoint behavior.
2. Planner target model `qwen3.5:27b` was not in healthy installed state (manifest missing / blob partial state during retries).
3. Baseline entry path previously had no preflight, so failures surfaced deep inside case run as repeated traps.

## Fixes Applied

### 1) Service topology normalized

- Enforced single Ollama service in `launchctl user/501`:
  - label: `homebrew.mxcl.ollama`
  - binary: `/opt/homebrew/opt/ollama/bin/ollama serve`
  - env includes:
    - `OLLAMA_HOST=0.0.0.0:11434`
    - `OLLAMA_FLASH_ATTENTION=1`
    - `OLLAMA_KV_CACHE_TYPE=q8_0`
- Verified only one `ollama serve` process exists and listener is `*:11434`.

### 2) Broken qwen3.5 remnants cleaned and pull restarted

- Removed stale `qwen3.5` manifests + `sha256-7935...` residual partial artifacts.
- Restarted pull:
  - process: `ollama pull qwen3.5:27b`
  - still in progress at handover time.

### 3) Code hardening: dual-brain preflight added

- File changed:
  - `src/bench/million-baseline-compare.ts`
- Added preflight gate before test loop for dual-brain mode:
  - planner/worker OpenAI-style endpoint checks:
    1. `GET /v1/models`
    2. `POST /v1/chat/completions` (`Reply exactly: OK`)
  - If model missing or load fails, benchmark exits fast with explicit error.
- Added env:
  - `TURINGOS_BASELINE_PREFLIGHT_ENABLED` (default `true`)
  - `TURINGOS_BASELINE_PREFLIGHT_TIMEOUT_MS` (default `60000`)

## Validation

1. Missing planner model now fails fast and explicit:
   - error: `[preflight:planner] model_not_listed target=qwen3.5:27b available=qwen2.5:7b`
2. Positive path with available planner (`qwen2.5:7b`) passes preflight and run:
   - command run with `--start-test 1 --max-tests 1`
   - result: `consecutive=1 status=PASS`
   - report:
     - `benchmarks/audits/baseline/million_baseline_compare_20260302_012647.json`

## Operational Check Commands

```bash
# Mac ollama single-service health
ssh mac-back 'ps -ww -Ao pid,ppid,etime,command | grep "[o]llama serve"; lsof -nP -iTCP:11434 -sTCP:LISTEN'

# launchctl user-domain label and env
ssh mac-back 'launchctl print user/$(id -u)/homebrew.mxcl.ollama | sed -n "1,80p"'

# qwen3.5 pull progress
ssh mac-back 'ps -ww -Ao pid,etime,command | grep "[o]llama pull qwen3.5:27b" || true'
ssh mac-back 'ls -lh ~/.ollama/models/blobs/sha256-7935de6e08f9444536d0edcacf19d2166b34bef8ddb4ac7ce9263ff5cad0693b-partial 2>/dev/null || true'
```

## Resume Rule

- Do not run planner=`qwen3.5:27b` baseline until `ollama list` contains `qwen3.5:27b`.
- If not present, preflight will intentionally block launch (expected behavior).

## Progress Update (2026-03-02 09:52 CST)

- Check result:
  - `qwen3.5:27b` still not in `ollama list`.
  - Previous pull had stalled (no active `ollama pull` process, partial file timestamp stale).
- Intervention executed:
  1. Removed stale residues:
     - `~/.ollama/models/blobs/sha256-7935...-partial`
     - `~/.ollama/models/blobs/sha256-7935...-partial-*`
     - `~/.ollama/models/manifests/registry.ollama.ai/library/qwen3.5`
  2. Restarted pull in controlled background:
     - PID: `40290`
     - Log: `/tmp/mac_pull_q35_recover_20260302_095136.log`
- 20s sample window after restart:
  - disk usage grew from `20744 KB` to `116704 KB`
  - transfer stabilized around `~5.0-5.3 MB/s`
  - rough ETA around `~54-58 minutes`
- Decision:
  - Keep current pull running (healthy progress resumed).
  - Only switch to manual mirror GGUF path if it stalls again or throughput drops persistently to unusable level.

## Mirror Switch Update (2026-03-02 09:57 CST)

- Trigger:
  - User requested immediate switch to domestic mirror/manual GGUF path.
- Executed actions:
  1. Stopped `ollama pull qwen3.5:27b`.
  2. Cleaned qwen3.5 residues again before switch:
     - `~/.ollama/models/blobs/sha256-7935...-partial*`
     - `~/.ollama/models/manifests/registry.ollama.ai/library/qwen3.5`
  3. Switched to mirror source:
     - repo: `bartowski/Qwen_Qwen3.5-27B-GGUF`
     - file: `Qwen_Qwen3.5-27B-Q4_K_M.gguf`
     - URL:
       - `https://hf-mirror.com/bartowski/Qwen_Qwen3.5-27B-GGUF/resolve/main/Qwen_Qwen3.5-27B-Q4_K_M.gguf`
  4. Started unattended chain job:
     - download (resume-enabled) -> `ollama create qwen3.5:27b` -> smoke (`Reply exactly: OK`)
     - PID: `40460`
     - log: `/tmp/mac_q35_mirror_install_20260302_095707.log`
     - target file: `/Users/zephryj/Downloads/turingos_models/qwen3.5-27b/Qwen_Qwen3.5-27B-Q4_K_M.gguf`
- Early throughput sample (first ~30s):
  - grew from `~92 MB` to `~251 MB`
  - transfer around `~6-7 MB/s`
  - ETA in log around `~40-45 min` (fluctuating)
- Additional residue check:
  - verified no remaining `sha256-7935...` partial residue under `~/.ollama/models/blobs/`.
  - mirror path now uses standalone file under:
    - `/Users/zephryj/Downloads/turingos_models/qwen3.5-27b/Qwen_Qwen3.5-27B-Q4_K_M.gguf`
  - `ollama pull qwen3.5:27b` process remains stopped during mirror download.

## Integrity + Channel Benchmark Update (2026-03-02 11:13 CST)

- Integrity incident observed:
  - first mirror file reached expected size but failed runtime load (`500 unable to load model`).
  - source expected SHA256: `bca098fbfe3a80cd7456462bf38a49d5e2dfe4eb118439062d93d8476394d9d1`
  - local SHA256 (bad file): `dc07176e619086b846c9d35dd820499612036a33b143fe12fbcd2c64ce4c14d5`
  - conclusion: size-only check is insufficient; must enforce hash validation before `ollama create`.

- Channel speed A/B sample from Mac (20s limited-range probe, concurrent with active large transfer):
  - `ModelScope` (`https://www.modelscope.cn/models/bartowski/Qwen_Qwen3.5-27B-GGUF/resolve/master/Qwen_Qwen3.5-27B-Q4_K_M.gguf`)
    - sample-1: `size=46890021B`, `speed=2344182Bps` (`~2.24 MiB/s`)
    - sample-2: `size=54983673B`, `speed=2749268Bps` (`~2.62 MiB/s`)
  - `hf-mirror` (`https://hf-mirror.com/bartowski/Qwen_Qwen3.5-27B-GGUF/resolve/main/Qwen_Qwen3.5-27B-Q4_K_M.gguf`)
    - sample-1: `size=15538235B`, `speed=772163Bps` (`~0.74 MiB/s`)
    - sample-2: `size=9897560B`, `speed=493898Bps` (`~0.47 MiB/s`)

- Decision for future manual GGUF installs:
  - Primary channel: `ModelScope resolve/master` URL.
  - Keep `hf-mirror` as fallback channel.
  - Mandatory guardrail:
    - verify expected file size and SHA256 before import.
    - only run `ollama create` after checksum passes.

- Current execution note:
  - did not switch channel mid-flight for this run per user instruction.
  - current repair flow continues with hash-verified re-download script:
    - `/tmp/mac_q35_redownload_verify.sh`

## Stop + Cache Cleanup Update (2026-03-02 11:17 CST)

- Trigger:
  - user requested to stop `hf-mirror` download and clean cache files.
- Stop actions:
  - terminated repair script and downloader:
    - `mac_q35_redownload_verify.sh` (PID `41878`)
    - active `curl` downloader for `Qwen_Qwen3.5-27B-Q4_K_M.gguf.part` (PID `41889`)
- Cache cleanup actions:
  - removed from `/Users/zephryj/Downloads/turingos_models/qwen3.5-27b/`:
    - `Qwen_Qwen3.5-27B-Q4_K_M.gguf.part`
    - `Qwen_Qwen3.5-27B-Q4_K_M.gguf.bad.*`
    - `Modelfile`
  - freed space: `19481424 KB` (about `18.6 GiB`)
  - directory now empty.
  - removed temporary scripts/logs:
    - `/tmp/mac_q35_*`
- Post-check:
  - `ollama list` no longer contains `qwen3.5:27b` (only `qwen2.5:7b` remains).

## Session Snapshot (2026-03-02 11:18 CST)

- Which mission we are in:
  - TuringOS `1M test` growth campaign on current codebase.
  - Runtime topology target: `planner on Mac` + `workers on Windows` (fixed 16 workers in current stable phase), then continue run-until-fail -> debug -> resume loop.
  - Reference progress file for this phase:
    - `g0_progress_fixed16_longrun_20260301_160614.md` (`consecutivePassBeforeFirstFail=15` at that checkpoint).

- Where it is blocked:
  - Mac planner model `qwen3.5:27b` is not in runnable state.
  - direct symptom: planner smoke fails with `500 unable to load model`.
  - integrity finding: previously downloaded GGUF had wrong SHA256 despite expected size.
  - after user stop command, all current qwen3.5 download artifacts were cleared, so planner model is currently absent.

- What is happening now:
  - all hf-mirror download processes are stopped.
  - cache/temporary files for this qwen3.5 attempt are cleaned.
  - baseline run is intentionally paused because planner preflight would fail without runnable `qwen3.5:27b`.

- Next step (execution order):
  1. Re-download `Qwen_Qwen3.5-27B-Q4_K_M.gguf` from `ModelScope` primary URL.
  2. Verify `size + SHA256` before import (hard gate).
  3. Run `ollama create qwen3.5:27b` and smoke `ollama run ... "Reply exactly: OK"`.
  4. Resume fixed16 long-run benchmark from last checkpoint and continue run-until-fail cycle.

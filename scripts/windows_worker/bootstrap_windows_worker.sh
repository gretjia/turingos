#!/usr/bin/env bash
set -euo pipefail

HOST="${1:-windows1-w1}"
ROOT="${ROOT:-D:\\work\\turingos_llm}"
MODEL="${MODEL:-qwen2.5-coder:7b}"
HOST_BIND="${HOST_BIND:-0.0.0.0:11434}"
CLIENT_HOST="${CLIENT_HOST:-http://127.0.0.1:11434}"
TASK_NAME="${TASK_NAME:-TuringOS-Worker-Cleanup}"
TASK_EVERY_MIN="${TASK_EVERY_MIN:-30}"
KEEP_HOURS="${KEEP_HOURS:-24}"
KEEP_CASE_DIRS="${KEEP_CASE_DIRS:-300}"
BASELINE_TMP_DIR="${BASELINE_TMP_DIR:-D:\\work\\Omega_vNext\\benchmarks\\tmp\\baseline_dualbrain}"
DOWNLOAD_URL="${DOWNLOAD_URL:-https://ollama.com/download/ollama-windows-amd64.zip}"
# Optional: reuse a pre-staged local archive on Windows to skip external download.
# Example: D:\work\turingos_llm\downloads\ollama-windows-amd64-macrelay.zip
ARCHIVE_PATH="${ARCHIVE_PATH:-}"
FORCE_REINSTALL="${FORCE_REINSTALL:-0}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REMOTE_DIR='D:\work\turingos_llm\ops'
SCP_REMOTE_DIR='/D:/work/turingos_llm/ops/'

run_remote_ps() {
  local ps_cmd="$1"
  ssh "$HOST" "powershell -NoProfile -ExecutionPolicy Bypass -Command \"$ps_cmd\""
}

echo "[1/5] Ensure remote ops directory"
run_remote_ps "New-Item -ItemType Directory -Force -Path '$REMOTE_DIR' | Out-Null"

echo "[2/5] Copy worker scripts"
scp "$SCRIPT_DIR/install_ollama.ps1" "$SCRIPT_DIR/start_ollama_worker.ps1" "$SCRIPT_DIR/cleanup_worker_cache.ps1" "$SCRIPT_DIR/register_cleanup_task.ps1" "$HOST:$SCP_REMOTE_DIR"

echo "[3/5] Install Ollama to D drive"
install_cmd="& '$REMOTE_DIR\\install_ollama.ps1' -Root '$ROOT' -DownloadUrl '$DOWNLOAD_URL'"
if [[ -n "$ARCHIVE_PATH" ]]; then
  install_cmd="$install_cmd -ArchivePath '$ARCHIVE_PATH'"
fi
if [[ "$FORCE_REINSTALL" == "1" ]]; then
  install_cmd="$install_cmd -ForceReinstall"
fi
run_remote_ps "$install_cmd"

echo "[4/5] Start Ollama and pull model: $MODEL"
run_remote_ps "& '$REMOTE_DIR\\start_ollama_worker.ps1' -Root '$ROOT' -HostBind '$HOST_BIND' -ClientHost '$CLIENT_HOST' -Model '$MODEL'"

echo "[5/5] Register cleanup scheduled task"
run_remote_ps "& '$REMOTE_DIR\\register_cleanup_task.ps1' -Root '$ROOT' -TaskName '$TASK_NAME' -EveryMinutes $TASK_EVERY_MIN -KeepHours $KEEP_HOURS -KeepLatestCaseDirs $KEEP_CASE_DIRS -BaselineTmpDir '$BASELINE_TMP_DIR'"

echo "Bootstrap complete."

#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

MAC_HOST="${MAC_HOST:-mac-back}"
WINDOWS_HOST="${WINDOWS_HOST:-windows1-w1}"

MAC_STAGE_DIR="${MAC_STAGE_DIR:-/Users/zephryj/Downloads/turingos_stage}"
ARCHIVE_URL="${ARCHIVE_URL:-https://ollama.com/download/ollama-windows-amd64.zip}"
ARCHIVE_NAME="${ARCHIVE_NAME:-ollama-windows-amd64.zip}"
MAC_HTTP_PORT="${MAC_HTTP_PORT:-18123}"

WINDOWS_ARCHIVE_PATH="${WINDOWS_ARCHIVE_PATH:-D:\\work\\turingos_llm\\downloads\\ollama-windows-amd64-macrelay.zip}"

# Forwarded to bootstrap_windows_worker.sh
ROOT="${ROOT:-D:\\work\\turingos_llm}"
MODEL="${MODEL:-qwen2.5-coder:7b}"
HOST_BIND="${HOST_BIND:-0.0.0.0:11434}"
CLIENT_HOST="${CLIENT_HOST:-http://127.0.0.1:11434}"
TASK_NAME="${TASK_NAME:-TuringOS-Worker-Cleanup}"
TASK_EVERY_MIN="${TASK_EVERY_MIN:-30}"
KEEP_HOURS="${KEEP_HOURS:-24}"
KEEP_CASE_DIRS="${KEEP_CASE_DIRS:-300}"
BASELINE_TMP_DIR="${BASELINE_TMP_DIR:-D:\\work\\Omega_vNext\\benchmarks\\tmp\\baseline_dualbrain}"

MAC_HTTP_PID=""

cleanup_mac_http() {
  if [[ -z "${MAC_HTTP_PID}" ]]; then
    return
  fi
  ssh "${MAC_HOST}" "kill ${MAC_HTTP_PID} >/dev/null 2>&1 || true" >/dev/null 2>&1 || true
}
trap cleanup_mac_http EXIT

echo "[1/6] Resolve Mac LAN IP"
MAC_LAN_IP="$(ssh "${MAC_HOST}" "ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true" | tr -d '\r' | tail -n 1)"
if [[ -z "${MAC_LAN_IP}" ]]; then
  echo "Failed to detect Mac LAN IP from ${MAC_HOST}" >&2
  exit 1
fi
echo "Mac LAN IP: ${MAC_LAN_IP}"

echo "[2/6] Download/archive package on Mac"
ssh "${MAC_HOST}" "mkdir -p '${MAC_STAGE_DIR}' && cd '${MAC_STAGE_DIR}' && if [ ! -s '${ARCHIVE_NAME}' ]; then curl -L --fail --retry 3 --retry-delay 2 -o '${ARCHIVE_NAME}' '${ARCHIVE_URL}'; fi && ls -lh '${ARCHIVE_NAME}'"

echo "[3/6] Start temporary HTTP server on Mac LAN"
MAC_HTTP_PID="$(ssh "${MAC_HOST}" "lsof -ti tcp:${MAC_HTTP_PORT} | xargs kill -9 2>/dev/null || true; cd '${MAC_STAGE_DIR}'; nohup python3 -m http.server '${MAC_HTTP_PORT}' --bind 0.0.0.0 >/tmp/turingos_mac_http_${MAC_HTTP_PORT}.log 2>&1 & echo \$!")"
if [[ -z "${MAC_HTTP_PID}" ]]; then
  echo "Failed to start Mac HTTP server" >&2
  exit 1
fi
echo "Mac HTTP PID: ${MAC_HTTP_PID}"

echo "[4/6] Pull archive from Mac LAN to Windows"
ssh "${WINDOWS_HOST}" "powershell -NoProfile -ExecutionPolicy Bypass -Command \"New-Item -ItemType Directory -Force -Path 'D:\\work\\turingos_llm\\downloads' | Out-Null; Invoke-WebRequest -Uri 'http://${MAC_LAN_IP}:${MAC_HTTP_PORT}/${ARCHIVE_NAME}' -OutFile '${WINDOWS_ARCHIVE_PATH}' -UseBasicParsing; (Get-Item '${WINDOWS_ARCHIVE_PATH}').Length\""

echo "[5/6] Stop temporary Mac HTTP server"
cleanup_mac_http
MAC_HTTP_PID=""

echo "[6/6] Bootstrap Windows worker from local archive"
(
  cd "${ROOT_DIR}"
  ARCHIVE_PATH="${WINDOWS_ARCHIVE_PATH}" \
  ROOT="${ROOT}" \
  MODEL="${MODEL}" \
  HOST_BIND="${HOST_BIND}" \
  CLIENT_HOST="${CLIENT_HOST}" \
  TASK_NAME="${TASK_NAME}" \
  TASK_EVERY_MIN="${TASK_EVERY_MIN}" \
  KEEP_HOURS="${KEEP_HOURS}" \
  KEEP_CASE_DIRS="${KEEP_CASE_DIRS}" \
  BASELINE_TMP_DIR="${BASELINE_TMP_DIR}" \
  bash scripts/windows_worker/bootstrap_windows_worker.sh "${WINDOWS_HOST}"
)

echo "Windows bootstrap via Mac LAN relay completed."

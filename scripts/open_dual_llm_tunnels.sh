#!/usr/bin/env bash
set -euo pipefail

# Opens planner forwarding tunnel from controller host.
# Worker lane uses linux tailnet endpoint directly (100.64.97.113:11434).
# Defaults can be overridden by environment variables:
#   TURINGOS_MAC_SSH_TARGET (default: zephryj@100.72.87.94)
#   TURINGOS_MAC_SSH_IDENTITY (default: ~/.ssh/id_ed25519_mac_backssh)
#   TURINGOS_MAC_SSH_PORT (optional)

kill_port_if_used() {
  local port="$1"
  if command -v fuser >/dev/null 2>&1; then
    fuser -k "${port}/tcp" >/dev/null 2>&1 || true
    return
  fi
  if command -v lsof >/dev/null 2>&1; then
    local pids
    pids="$(lsof -ti tcp:"${port}" -sTCP:LISTEN 2>/dev/null || true)"
    if [[ -n "${pids}" ]]; then
      # shellcheck disable=SC2086
      kill ${pids} 2>/dev/null || true
      sleep 1
      # shellcheck disable=SC2086
      kill -9 ${pids} 2>/dev/null || true
    fi
  fi
}

MAC_SSH_TARGET="${TURINGOS_MAC_SSH_TARGET:-zephryj@100.72.87.94}"
MAC_SSH_IDENTITY="${TURINGOS_MAC_SSH_IDENTITY:-${HOME}/.ssh/id_ed25519_mac_backssh}"
MAC_SSH_PORT="${TURINGOS_MAC_SSH_PORT:-}"

SSH_ARGS=(
  -fN
  -L 11434:127.0.0.1:11434
  -o StrictHostKeyChecking=accept-new
  -o ConnectTimeout=8
)

if [[ -n "${MAC_SSH_IDENTITY}" ]]; then
  SSH_ARGS+=(-i "${MAC_SSH_IDENTITY}")
fi
if [[ -n "${MAC_SSH_PORT}" ]]; then
  SSH_ARGS+=(-p "${MAC_SSH_PORT}")
fi

kill_port_if_used 11434
ssh "${SSH_ARGS[@]}" "${MAC_SSH_TARGET}"

echo "[ok] planner tunnel: 127.0.0.1:11434 -> ${MAC_SSH_TARGET}:11434"
echo "[ok] worker endpoint: http://100.64.97.113:11434"

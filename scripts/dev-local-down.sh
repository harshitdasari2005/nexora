#!/usr/bin/env bash
# Nexora one-command local development shutdown.
#
#   pnpm dev:local:down
#
# Stops the API/Web dev servers started by `pnpm dev:local` (exactly those
# PIDs — nothing else), then runs `docker compose down` on the Nexora
# infrastructure. Volumes and all data are preserved (never `-v`), unrelated
# processes are never touched, and host port 9000 is left alone.
#
# Note: Ctrl+C in the `pnpm dev:local` terminal already stops the API/Web
# servers; this command additionally stops the infrastructure containers.

set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_BASE="$ROOT_DIR/infrastructure/compose/docker-compose.yml"
COMPOSE_MINIO="$ROOT_DIR/infrastructure/compose/docker-compose.minio-ports.yml"
COMPOSE_FILES=(-f "$COMPOSE_BASE" -f "$COMPOSE_MINIO")

PID_FILE="${TMPDIR:-/tmp}/nexora-dev-local.pids"

red() { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
info() { printf '\033[36m%s\033[0m\n' "$*"; }

# Kills a process and its descendants by exact PID tree (never broad).
kill_tree() {
  local pid="$1"
  local children
  children="$(ps -o pid= -o ppid= -ax 2>/dev/null | awk -v p="$pid" '$2 == p { print $1 }')"
  for child in $children; do
    kill_tree "$child"
  done
  kill "$pid" 2>/dev/null || true
}

info "Nexora local development shutdown"

# --- 1. stop the launcher-managed API/Web processes (exact PIDs only) ---------

if [[ -f "$PID_FILE" ]]; then
  while IFS= read -r pid; do
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      info "  stopping managed process ${pid}"
      kill_tree "$pid"
    fi
  done < "$PID_FILE"
  rm -f "$PID_FILE"
else
  info "  no launcher-managed dev processes found (nothing to stop)"
fi

# --- 2. stop infrastructure containers (volumes preserved) --------------------

if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  info "Stopping Nexora infrastructure containers (volumes preserved)…"
  docker compose "${COMPOSE_FILES[@]}" down || {
    red "docker compose down failed — see messages above"
    exit 1
  }
  green "Infrastructure stopped. Volumes and data are preserved."
else
  info "Docker is not running — nothing to stop (volumes remain intact)."
fi

green "Done."

#!/usr/bin/env bash
# Nexora one-command local development launcher.
#
#   pnpm dev:local
#
# Starts the Docker infrastructure (PostgreSQL, Redis, MinIO, Keycloak),
# waits until every service is actually healthy, then starts the API
# (:3001) and Web (:5173) dev servers with their logs in this terminal.
# Ctrl+C stops the API/Web processes cleanly; infrastructure containers
# keep running (see `pnpm dev:local:down` to stop them).
#
# Fail-safe behavior:
#   - Docker not running            -> clear message, exit
#   - API/Web port already in use   -> reports the conflict, NEVER kills the
#     occupying process (including unrelated projects on those ports)
#   - a service fails its health    -> names the service, exits
#
# Overrides (optional, for machines where a port is taken):
#   NEXORA_API_PORT=3100 NEXORA_WEB_PORT=5174 pnpm dev:local
# (Sign-in through Keycloak is registered for the default ports 3001/5173.)
#
# MinIO's host port follows S3_PORT in .env (default 9000; console = S3_PORT + 1),
# so the API always talks to the port MinIO is actually on.

set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_BASE="$ROOT_DIR/infrastructure/compose/docker-compose.yml"
COMPOSE_FILES=(-f "$COMPOSE_BASE")
ENV_FILE="$ROOT_DIR/.env"

# Ports (overridable; defaults match the standard stack).
API_PORT="${NEXORA_API_PORT:-3001}"
WEB_PORT="${NEXORA_WEB_PORT:-5173}"
WEB_ORIGIN="http://localhost:${WEB_PORT}"

# Where the launcher records the API/Web PIDs it manages (used by
# `pnpm dev:local:down` to stop exactly these processes).
PID_FILE="${TMPDIR:-/tmp}/nexora-dev-local.pids"

# Opening the browser is a convenience only — disable with `--no-open` or
# NEXORA_OPEN_BROWSER=0.
OPEN_BROWSER=1
if [[ "$*" == *"--no-open"* ]] || [[ "${NEXORA_OPEN_BROWSER:-1}" == "0" ]]; then
  OPEN_BROWSER=0
fi

# --- helpers --------------------------------------------------------------

red() { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
info() { printf '\033[36m%s\033[0m\n' "$*"; }

fail() {
  red "ERROR: $*"
  exit 1
}

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

cleanup() {
  # Stop ONLY the API/Web processes this launcher started.
  if [[ -f "$PID_FILE" ]]; then
    while IFS= read -r pid; do
      [[ -n "$pid" ]] && kill_tree "$pid"
    done < "$PID_FILE"
    rm -f "$PID_FILE"
  fi
}
trap cleanup EXIT INT TERM

# Waits until a compose container reports `healthy` (its compose-defined
# healthcheck), with a per-service timeout.
wait_for_container_health() {
  local container="$1"
  local label="$2"
  local timeout_s="${3:-120}"
  local waited=0
  info "  waiting for ${label} (${container})…"
  while ((waited < timeout_s)); do
    local status
    status="$(docker inspect -f '{{.State.Health.Status}}' "$container" 2>/dev/null || echo unknown)"
    if [[ "$status" == "healthy" ]]; then
      green "  ${label} healthy"
      return 0
    fi
    if [[ "$status" == "unhealthy" ]]; then
      fail "${label} (${container}) is UNHEALTHY — check: docker logs ${container}"
    fi
    sleep 3
    waited=$((waited + 3))
  done
  fail "${label} (${container}) did not become healthy within ${timeout_s}s — check: docker logs ${container}"
}

# Waits until the API answers its health endpoint with status ok.
wait_for_api() {
  local waited=0
  info "  waiting for API health at http://localhost:${API_PORT}/api/health…"
  while ((waited < 90)); do
    if curl -fsS --max-time 2 "http://localhost:${API_PORT}/api/health" 2>/dev/null |
      python3 -c 'import sys, json; sys.exit(0 if json.load(sys.stdin).get("status") == "ok" else 1)' 2>/dev/null; then
      green "  API healthy (port ${API_PORT})"
      return 0
    fi
    sleep 2
    waited=$((waited + 2))
  done
  fail "API did not become healthy within 90s — check the API logs above"
}

# Waits until the Web dev server answers HTTP 200.
wait_for_web() {
  local waited=0
  info "  waiting for Web at ${WEB_ORIGIN}…"
  while ((waited < 90)); do
    local code
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "${WEB_ORIGIN}" 2>/dev/null || true)"
    if [[ "$code" == "200" ]]; then
      green "  Web available (${WEB_ORIGIN})"
      return 0
    fi
    sleep 2
    waited=$((waited + 2))
  done
  fail "Web did not respond with HTTP 200 within 90s — check the Web logs above"
}

# --- 0. prerequisites -------------------------------------------------------

info "Nexora local development launcher"
info "  API port: ${API_PORT}  Web port: ${WEB_PORT}"

if [[ ! -f "$ENV_FILE" ]]; then
  fail "No .env at the repo root. Create it with: cp .env.example .env — then re-run: pnpm dev:local"
fi

if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
  fail "Docker is not running. Start Docker Desktop, then re-run: pnpm dev:local"
fi

# MinIO is published on the port the API will use (S3_PORT in .env).
S3_PORT_FROM_ENV="$(grep -E '^S3_PORT=' "$ENV_FILE" | tail -1 | cut -d= -f2 | tr -d '[:space:]\"'"'"'')"
export NEXORA_MINIO_PORT="${S3_PORT_FROM_ENV:-9000}"
export NEXORA_MINIO_CONSOLE_PORT="${NEXORA_MINIO_CONSOLE_PORT:-$((NEXORA_MINIO_PORT + 1))}"
info "  MinIO port: ${NEXORA_MINIO_PORT} (S3_PORT in .env)"

# --- 1. port conflicts (report, never kill) ---------------------------------

for entry in "${API_PORT}:API" "${WEB_PORT}:Web"; do
  port="${entry%%:*}"
  name="${entry##*:}"
  if lsof -nP -iTCP:"${port}" -sTCP:LISTEN >/dev/null 2>&1; then
    local_pid="$(lsof -nP -iTCP:"${port}" -sTCP:LISTEN -t 2>/dev/null | head -1)"
    fail "${name} port ${port} is already in use (PID ${local_pid:-?}). The launcher will NOT kill it — free the port or use NEXORA_API_PORT/NEXORA_WEB_PORT to pick another."
  fi
done

# --- 2. infrastructure up -----------------------------------------------------

info "Starting Docker infrastructure (PostgreSQL, Redis, MinIO, Keycloak)…"
docker compose "${COMPOSE_FILES[@]}" up -d || fail "docker compose up failed"

# --- 3. wait for infrastructure health ----------------------------------------

wait_for_container_health nexora-postgres "PostgreSQL" 90
wait_for_container_health nexora-redis "Redis" 60
wait_for_container_health nexora-minio "MinIO" 60
wait_for_container_health nexora-keycloak "Keycloak" 180
green "Infrastructure ready"

# --- 4. start API + Web (logs stay in this terminal) ---------------------------

info "Starting API and Web dev servers…"
(
  cd "$ROOT_DIR" || exit 1
  PORT="$API_PORT" pnpm --filter @nexora/app-api run dev
) &
API_PID=$!

(
  cd "$ROOT_DIR" || exit 1
  # `run dev --port N`: the single `--` is consumed by pnpm, so Vite
  # receives `--port N` (NOT `-- --port N`). NEXORA_API_PORT points the
  # /api proxy at the API started above.
  NEXORA_API_PORT="$API_PORT" pnpm --filter @nexora/app-web run dev --port "$WEB_PORT"
) &
WEB_PID=$!

printf '%s\n%s\n' "$API_PID" "$WEB_PID" > "$PID_FILE"

# --- 5. wait for API + Web ------------------------------------------------------

wait_for_api
wait_for_web

green ""
green "Nexora is up."
green "  API: http://localhost:${API_PORT}/api/health"
green "  Web: ${WEB_ORIGIN}"
info "Ctrl+C stops the API/Web servers (infrastructure keeps running)."
info "Stop everything with: pnpm dev:local:down"
echo

if [[ "$OPEN_BROWSER" == "1" ]] && [[ "$(uname)" == "Darwin" ]] && command -v open >/dev/null 2>&1; then
  (open "${WEB_ORIGIN}" >/dev/null 2>&1 &) || true
fi

# Foreground wait: keeps the API/Web logs streaming in this terminal and lets
# Ctrl+C reach the process group (trap cleans up the managed PIDs).
wait

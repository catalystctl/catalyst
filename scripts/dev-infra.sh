#!/usr/bin/env bash
# =============================================================================
# Catalyst — Development infrastructure bootstrap (PostgreSQL + Redis)
#
# Backs `pnpm run dev:infra` and dev_run.sh. Idempotent:
#   - creates catalyst-docker/.env from .env.example when missing
#   - repairs empty/placeholder POSTGRES_PASSWORD, REDIS_PASSWORD, and
#     BETTER_AUTH_SECRET (compose refuses to boot Redis without a password)
#   - starts postgres + redis and waits for both to become healthy
#
# Unlike the old inline `podman-compose up 2>/dev/null || true`, failures are
# printed and the script exits non-zero.
# =============================================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR/catalyst-docker"

err()  { printf 'dev:infra: ERROR: %s\n' "$*" >&2; }
info() { printf 'dev:infra: %s\n' "$*"; }

# --- detect a working compose command ----------------------------------------
if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  COMPOSE=(docker compose)
elif command -v podman >/dev/null 2>&1 && podman compose version >/dev/null 2>&1; then
  COMPOSE=(podman compose)
elif command -v podman-compose >/dev/null 2>&1; then
  COMPOSE=(podman-compose)
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE=(docker-compose)
else
  err "no compose implementation found (docker compose / podman compose / podman-compose / docker-compose)"
  exit 1
fi
info "using compose: ${COMPOSE[*]}"

# --- .env bootstrap / repair ---------------------------------------------------
env_get() { grep -E "^$1=" .env 2>/dev/null | tail -1 | cut -d= -f2-; }
env_set() {
  if grep -qE "^$1=" .env 2>/dev/null; then
    sed -i "s|^$1=.*|$1=$2|" .env
  else
    printf '%s=%s\n' "$1" "$2" >> .env
  fi
}

if [[ ! -f .env ]]; then
  cp .env.example .env
  info "created .env from .env.example"
fi

pg_pass="$(env_get POSTGRES_PASSWORD)"
if [[ -z "$pg_pass" || "$pg_pass" == CHANGE_ME* ]]; then
  # Dev default matching catalyst-backend/.env DATABASE_URL examples. Never
  # overwrite a real password: Postgres only applies it on first volume init.
  env_set POSTGRES_PASSWORD "catalyst_dev"
  info "set POSTGRES_PASSWORD=catalyst_dev (dev default)"
fi

redis_pass="$(env_get REDIS_PASSWORD)"
if [[ -z "$redis_pass" || "$redis_pass" == CHANGE_ME* ]]; then
  redis_pass="$(openssl rand -base64 24 2>/dev/null | tr -d '/+=' | head -c 32)"
  if [[ -z "$redis_pass" ]]; then
    err "openssl not available — cannot generate REDIS_PASSWORD"
    exit 1
  fi
  # Alphanumeric only: the value flows into --requirepass and REDIS_URL.
  env_set REDIS_PASSWORD "$redis_pass"
  info "generated REDIS_PASSWORD (was empty/placeholder — compose refuses to start Redis without it)"
fi

auth_secret="$(env_get BETTER_AUTH_SECRET)"
if [[ -z "$auth_secret" || "$auth_secret" == CHANGE_ME* ]]; then
  env_set BETTER_AUTH_SECRET "$(openssl rand -base64 32 2>/dev/null || echo dev-secret-change-me-0123456789abcdef)"
  info "generated BETTER_AUTH_SECRET"
fi

# --- health probes -------------------------------------------------------------
pg_user="$(env_get POSTGRES_USER)"; pg_user="${pg_user:-catalyst}"
pg_db="$(env_get POSTGRES_DB)";     pg_db="${pg_db:-catalyst_db}"

health_pg() {
  "${COMPOSE[@]}" exec -T postgres pg_isready -U "$pg_user" -d "$pg_db" >/dev/null 2>&1
}

health_redis() {
  local rp
  rp="$(env_get REDIS_PASSWORD)"
  "${COMPOSE[@]}" exec -T -e REDISCLI_AUTH="$rp" redis \
    redis-cli --no-auth-warning ping 2>/dev/null | grep -q PONG
}

wait_healthy() {
  local tries=0
  until health_pg && health_redis; do
    tries=$((tries + 1))
    [[ "$tries" -ge 60 ]] && return 1
    sleep 1
  done
}

# --- start ----------------------------------------------------------------------
# Already healthy (prev run / dev_run.sh)? Nothing to do — avoids podman-compose
# name-conflict noise from `up` against existing containers.
if health_pg && health_redis; then
  info "postgres + redis already up and healthy"
  exit 0
fi

info "starting postgres + redis..."
if ! "${COMPOSE[@]}" up -d --no-recreate postgres redis; then
  info "up --no-recreate failed — retrying with force-recreate"
  "${COMPOSE[@]}" up -d --force-recreate postgres redis || { err "compose up failed — see output above"; exit 1; }
fi

if wait_healthy; then
  info "postgres + redis are up and healthy"
  exit 0
fi

# podman-compose 1.x exits 0 even when a port publish fails, leaving the
# container in Created state. Force-recreate from the current .env and retry.
info "containers not healthy — force-recreating from current .env..."
"${COMPOSE[@]}" up -d --force-recreate postgres redis || true
if wait_healthy; then
  info "postgres + redis are up and healthy"
  exit 0
fi

err "postgres/redis did not become healthy"
err "inspect with: cd catalyst-docker && ${COMPOSE[*]} logs postgres redis"
err "common cause: host port 5432/6379 already in use — set POSTGRES_PORT / REDIS_PORT in catalyst-docker/.env"
exit 1

#!/usr/bin/env bash
# =============================================================================
# Catalyst - development stack control
#
# Drives catalyst-docker/docker-compose.dev.yml: Postgres, Redis, the backend
# (tsx --watch) and the frontend (Vite + HMR), all in containers with the source
# bind-mounted. Backs the `pnpm run dev:stack*` scripts; run it directly for the
# full command list:
#
#   ./scripts/dev-stack.sh help
#
# It creates catalyst-docker/.env.dev from the example on first use, generates
# BETTER_AUTH_SECRET, and resolves host-port conflicts by moving the default
# port to the next free one (remembered in .env.dev). A port you set yourself is
# never changed - the script stops and says so instead.
# =============================================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DOCKER_DIR="$ROOT_DIR/catalyst-docker"
ENV_FILE="$DOCKER_DIR/.env.dev"
ENV_EXAMPLE="$DOCKER_DIR/.env.dev.example"
COMPOSE_FILE="$DOCKER_DIR/docker-compose.dev.yml"
PROJECT_NAME="catalyst-dev"
IMAGE_TAG="catalyst-dev:local"

# --- output ------------------------------------------------------------------
if [[ -t 1 ]]; then
    C_RESET=$'\033[0m'; C_BOLD=$'\033[1m'; C_DIM=$'\033[2m'
    C_RED=$'\033[31m'; C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'
else
    C_RESET=''; C_BOLD=''; C_DIM=''; C_RED=''; C_GREEN=''; C_YELLOW=''
fi

info() { printf '%sdev:stack:%s %s\n' "$C_BOLD" "$C_RESET" "$*"; }
ok()   { printf '%sdev:stack:%s %s\n' "${C_BOLD}${C_GREEN}" "$C_RESET" "$*"; }
warn() { printf '%sdev:stack:%s %s\n' "${C_BOLD}${C_YELLOW}" "$C_RESET" "$*" >&2; }
err()  { printf '%sdev:stack: ERROR:%s %s\n' "${C_BOLD}${C_RED}" "$C_RESET" "$*" >&2; }
die()  { err "$*"; exit 1; }

# --- compose detection -------------------------------------------------------
COMPOSE=()
ENGINE=""

detect_compose() {
    if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
        COMPOSE=(docker compose); ENGINE="docker"
    elif command -v podman >/dev/null 2>&1 && podman compose version >/dev/null 2>&1; then
        COMPOSE=(podman compose); ENGINE="podman"
    elif command -v podman-compose >/dev/null 2>&1; then
        COMPOSE=(podman-compose); ENGINE="podman"
    elif command -v docker-compose >/dev/null 2>&1; then
        COMPOSE=(docker-compose); ENGINE="docker"
    else
        die "no compose implementation found (docker compose / podman compose / podman-compose / docker-compose)"
    fi
}

compose() {
    "${COMPOSE[@]}" --project-name "$PROJECT_NAME" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

# --- .env.dev ----------------------------------------------------------------
env_get() {
    grep -E "^$1=" "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- || true
}

env_or() { # env_or <key> <default>
    local value
    value="$(env_get "$1")"
    printf '%s' "${value:-$2}"
}

env_set() {
    local key="$1" value="$2"
    if grep -qE "^${key}=" "$ENV_FILE" 2>/dev/null; then
        sed -i "s|^${key}=.*|${key}=${value}|" "$ENV_FILE"
    else
        printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
    fi
}

ensure_env_file() {
    [[ -f "$ENV_FILE" ]] || { cp "$ENV_EXAMPLE" "$ENV_FILE"; info "created catalyst-docker/.env.dev"; }

    # Merge in keys the example gained since this file was created: the compose
    # file substitutes every one of them without a default, and an unset ${VAR}
    # reaches the container as a literal string under podman-compose.
    local line key
    while IFS= read -r line; do
        [[ -z "$line" || "$line" == \#* ]] && continue
        key="${line%%=*}"
        if ! grep -qE "^${key}=" "$ENV_FILE" 2>/dev/null; then
            printf '%s\n' "$line" >> "$ENV_FILE"
            info "added $key to catalyst-docker/.env.dev"
        fi
    done < "$ENV_EXAMPLE"

    if [[ -z "$(env_get BETTER_AUTH_SECRET)" ]]; then
        command -v openssl >/dev/null 2>&1 || die "openssl is required to generate BETTER_AUTH_SECRET"
        env_set BETTER_AUTH_SECRET "$(openssl rand -base64 32 | tr -d '\n')"
        info "generated BETTER_AUTH_SECRET in catalyst-docker/.env.dev"
    fi
}

# --- host ports --------------------------------------------------------------
port_in_use() {
    (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null
}

# True while this stack's own containers run: they hold the published ports, so
# re-resolving those ports would report our own containers as a conflict.
stack_is_up() {
    local name running
    for name in catalyst-dev-postgres catalyst-dev-redis catalyst-dev-backend catalyst-dev-frontend; do
        running="$("$ENGINE" inspect -f '{{.State.Running}}' "$name" 2>/dev/null || true)"
        [[ "$running" == "true" ]] && return 0
    done
    return 1
}

# resolve_port <env key> <default>: prints the usable port, bumping a busy
# default to the next free one (persisted), and refusing to move a port the user
# configured by hand.
resolve_port() {
    local name="$1" default="$2"
    local configured port candidate tries

    configured="$(env_get "$name")"
    port="${configured:-$default}"

    if ! port_in_use "$port"; then
        printf '%s' "$port"
        return 0
    fi

    if [[ -n "$configured" && "$configured" != "$default" ]]; then
        err "$name=$configured (catalyst-docker/.env.dev) is already in use on the host."
        err "  Free that port, or set $name to a free one and retry."
        return 1
    fi

    candidate=$((port + 1))
    tries=0
    while port_in_use "$candidate"; do
        candidate=$((candidate + 1))
        tries=$((tries + 1))
        [[ "$tries" -ge 40 ]] && { err "no free port found near $port for $name"; return 1; }
    done

    env_set "$name" "$candidate"
    warn "$name: port $port is busy - using $candidate (saved to catalyst-docker/.env.dev)"
    printf '%s' "$candidate"
}

prepare_env() {
    ensure_env_file

    local prev_frontend prev_backend
    prev_frontend="$(env_or DEV_FRONTEND_PORT 5173)"
    prev_backend="$(env_or DEV_BACKEND_PORT 3000)"

    if stack_is_up; then
        # Already running: the ports below are held by these containers.
        DEV_FRONTEND_PORT="$prev_frontend"
        DEV_BACKEND_PORT="$prev_backend"
        DEV_POSTGRES_PORT="$(env_or DEV_POSTGRES_PORT 5433)"
        DEV_REDIS_PORT="$(env_or DEV_REDIS_PORT 6380)"
    else
        DEV_FRONTEND_PORT="$(resolve_port DEV_FRONTEND_PORT 5173)"
        DEV_BACKEND_PORT="$(resolve_port DEV_BACKEND_PORT 3000)"
        DEV_POSTGRES_PORT="$(resolve_port DEV_POSTGRES_PORT 5433)"
        DEV_REDIS_PORT="$(resolve_port DEV_REDIS_PORT 6380)"
    fi

    # Derived URLs follow the resolved ports. A value that is not the one the
    # previous ports imply was set by hand, and is left alone.
    PUBLIC_URL="$(env_get PUBLIC_URL)"
    if [[ -z "$PUBLIC_URL" || "$PUBLIC_URL" == "http://localhost:$prev_frontend" ]]; then
        PUBLIC_URL="http://localhost:$DEV_FRONTEND_PORT"
        env_set PUBLIC_URL "$PUBLIC_URL"
    fi

    local key value
    for key in BETTER_AUTH_URL CORS_ORIGIN FRONTEND_URL; do
        value="$(env_get "$key")"
        if [[ -z "$value" || "$value" == "http://localhost:$prev_frontend" ]]; then
            env_set "$key" "$PUBLIC_URL"
        fi
    done
    for key in BACKEND_URL BACKEND_EXTERNAL_ADDRESS; do
        value="$(env_get "$key")"
        if [[ -z "$value" || "$value" == "http://localhost:$prev_backend" ]]; then
            env_set "$key" "http://localhost:$DEV_BACKEND_PORT"
        fi
    done
}

# --- image freshness ---------------------------------------------------------
file_epoch() {
    stat -c %Y "$1" 2>/dev/null || stat -f %m "$1" 2>/dev/null || printf '0'
}

image_epoch() {
    local created
    created="$("$ENGINE" image inspect -f '{{.Created}}' "$IMAGE_TAG" 2>/dev/null || true)"
    [[ -n "$created" ]] || { printf '0'; return 0; }
    date -d "$created" +%s 2>/dev/null || printf '0'
}

# Warn when a dependency manifest is newer than the image: the containers would
# run with an install that no longer matches the lockfile.
check_image_freshness() {
    local image_created newest=0 file epoch
    image_created="$(image_epoch)"
    [[ "$image_created" -gt 0 ]] || return 0

    for file in "$ROOT_DIR/pnpm-lock.yaml" "$ROOT_DIR/package.json" \
                "$ROOT_DIR/catalyst-backend/package.json" \
                "$ROOT_DIR/catalyst-frontend/package.json" \
                "$ROOT_DIR/packages/plugin-sdk/package.json" \
                "$ROOT_DIR/packages/mcp-server/package.json"; do
        [[ -f "$file" ]] || continue
        epoch="$(file_epoch "$file")"
        [[ "$epoch" -gt "$newest" ]] && newest="$epoch"
    done

    if [[ "$newest" -gt "$image_created" ]]; then
        warn "a package.json or the lockfile changed after the dev image was built."
        warn "  Rebuild it: pnpm run dev:stack:build"
    fi
}

# --- helpers -----------------------------------------------------------------
require_stack_up() {
    if stack_is_up; then
        return 0
    fi
    warn "the dev stack is not running - start it with: pnpm run dev:stack"
    return 1
}

wait_for_backend() {
    local url="http://localhost:${DEV_BACKEND_PORT}/health" tries=0
    if ! command -v curl >/dev/null 2>&1; then
        info "curl not found - skipping the API wait"
        return 0
    fi
    printf '%sdev:stack:%s waiting for the API' "$C_BOLD" "$C_RESET"
    while ! curl -sf --max-time 2 "$url" >/dev/null 2>&1; do
        tries=$((tries + 1))
        if [[ "$tries" -ge 90 ]]; then
            printf '\n'
            warn "the API did not answer at $url after ~3 minutes."
            warn "  Check the logs: pnpm run dev:stack:logs backend"
            return 1
        fi
        printf '.'
        sleep 2
    done
    printf ' ready\n'
}

print_summary() {
    local panel="${PUBLIC_URL:-http://localhost:${DEV_FRONTEND_PORT}}"
    local db_user db_pass db_name
    db_user="$(env_or POSTGRES_USER catalyst)"
    db_pass="$(env_or POSTGRES_PASSWORD catalyst_dev)"
    db_name="$(env_or POSTGRES_DB catalyst_db)"

    printf '\n'
    printf '%s\n' "${C_BOLD}  Catalyst dev stack${C_RESET}"
    printf '  %-9s %s\n' "Panel"    "$panel"
    printf '  %-9s %s\n' "API"      "http://localhost:${DEV_BACKEND_PORT}/api"
    printf '  %-9s %s\n' "API docs" "http://localhost:${DEV_BACKEND_PORT}/docs"
    printf '  %-9s %s\n' "Postgres" "postgresql://${db_user}:${db_pass}@localhost:${DEV_POSTGRES_PORT}/${db_name}"
    printf '  %-9s %s\n' "Redis"    "redis://localhost:${DEV_REDIS_PORT}"
    printf '  %s\n' "${C_DIM}  logs: pnpm run dev:stack:logs   stop: pnpm run dev:stack:down${C_RESET}"
    printf '  %s\n' "${C_DIM}  new database? create the admin: pnpm run dev:stack:seed:admin${C_RESET}"
    printf '\n'
}

usage() {
    cat <<'EOF'
Catalyst - development stack control

Usage: pnpm run dev:stack[:<command>] [args]   (or ./scripts/dev-stack.sh <command>)

  up [--build] [--no-wait] [-f]   Start the stack (builds the image if missing)
                                  -f/--foreground: attach and stream logs
  build [--no-cache]              Build/refresh the dev image
  rebuild                         Build, then recreate the app containers
  down                            Stop the stack (keeps the database)
  reset [--yes]                   Stop and DELETE the dev database and plugin data
  restart [service...]            Restart services (all when none given)
  logs [service...]               Follow logs (all when none given)
  ps                              Show service status
  shell [service]                 Shell inside a running service (default: backend)
  exec <service> <cmd...>         Run a command in a running service
  run [service] <cmd...>          Run a command in a throwaway container
  test [backend|frontend|all]     Run the unit tests in a throwaway container
  migrate                         Apply committed migrations (prisma migrate deploy)
  migrate:dev [name]              Author a migration (prisma migrate dev)
  generate                        Regenerate the Prisma client
  seed | seed:admin               Seed sample data / create the local admin
  studio                          Prisma Studio (host CLI) on the dev database
  env                             Print URLs and connection strings
  help                            This text

Examples:
  pnpm run dev:stack
  pnpm run dev:stack:logs backend
  pnpm run dev:stack:run backend pnpm --filter catalyst-backend run test
  pnpm run dev:stack:shell frontend
  ./scripts/dev-stack.sh reset --yes        # --yes bypasses the confirmation

Files created inside the containers land in the bind-mounted source tree; with
rootless Podman they are owned by you, with rootful Docker by root.
EOF
}

# --- commands ----------------------------------------------------------------
cmd_up() {
    local build=0 wait=1 foreground=0
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --build) build=1 ;;
            --no-wait) wait=0 ;;
            -f|--foreground) foreground=1 ;;
            *) die "unknown option for up: $1 (see: pnpm run dev:stack:help)" ;;
        esac
        shift
    done

    prepare_env
    # Build when asked, or when there is nothing to run yet.
    if [[ "$build" -eq 1 ]] || ! "$ENGINE" image inspect "$IMAGE_TAG" >/dev/null 2>&1; then
        compose build
    fi
    check_image_freshness

    if [[ "$foreground" -eq 1 ]]; then
        print_summary
        info "streaming logs - Ctrl+C stops this view, the stack keeps running"
        compose up
        return 0
    fi

    compose up -d
    if [[ "$wait" -eq 1 ]]; then
        wait_for_backend || true
    fi
    print_summary
}

cmd_build() {
    ensure_env_file
    compose build "$@"
    ok "dev image built ($IMAGE_TAG)"
}

cmd_rebuild() {
    prepare_env
    compose build "$@"
    compose up -d --force-recreate backend frontend
    wait_for_backend || true
    print_summary
}

# `down` removes the containers but leaves the per-container volumes that hold
# the bind-mounted node_modules (they are recreated from the image on the next
# up, so they are pure waste between runs). Keep the declared data volumes.
prune_container_volumes() {
    local name
    while IFS= read -r name; do
        [[ -n "$name" ]] || continue
        case "$name" in
            "${PROJECT_NAME}_catalyst-dev-postgres-data" | "${PROJECT_NAME}_catalyst-dev-backend-data") continue ;;
        esac
        "$ENGINE" volume rm -f "$name" >/dev/null 2>&1 || true
    done < <("$ENGINE" volume ls --format '{{.Name}}' 2>/dev/null | grep "^${PROJECT_NAME}_" || true)
}

cmd_down() {
    ensure_env_file
    compose down "$@"
    prune_container_volumes
    ok "dev stack stopped (the database volume is kept; 'dev:stack:reset' deletes it)"
}

cmd_reset() {
    local yes=0
    case "${1:-}" in
        --yes|-y) yes=1 ;;
    esac

    ensure_env_file
    if [[ "$yes" -eq 0 ]]; then
        if [[ -t 0 ]]; then
            local reply
            read -r -p "Delete the dev database, plugin and backup data? [y/N] " reply
            [[ "$reply" =~ ^[Yy]$ ]] || { info "aborted"; return 0; }
        else
            die "reset needs --yes when not run interactively"
        fi
    fi

    compose down -v
    prune_container_volumes
    ok "dev volumes deleted - the next 'pnpm run dev:stack' starts from an empty database"
}

cmd_restart() {
    ensure_env_file
    compose restart "$@"
}

cmd_logs() {
    ensure_env_file
    compose logs -f --tail=100 "$@"
}

cmd_ps() {
    ensure_env_file
    compose ps "$@"
}

cmd_shell() {
    ensure_env_file
    compose exec "${1:-backend}" sh
}

cmd_exec() {
    local service="${1:-}"
    shift || true
    [[ -n "$service" ]] || die "usage: dev-stack.sh exec <service> <command...>"
    [[ $# -gt 0 ]] || die "usage: dev-stack.sh exec <service> <command...>"
    prepare_env
    compose exec "$service" "$@"
}

cmd_run() {
    local service="backend"
    if [[ $# -gt 1 ]] && [[ "$1" =~ ^(backend|frontend)$ ]]; then
        service="$1"
        shift
    fi
    [[ $# -gt 0 ]] || die "usage: dev-stack.sh run [backend|frontend] <command...>"
    prepare_env
    # Keep a TTY when a human is watching, drop it when the output is piped so
    # reporters stay in non-interactive mode.
    local tty=()
    [[ -t 1 ]] || tty=(-T)
    compose run --rm "${tty[@]}" --no-deps "$service" "$@"
}

cmd_test() {
    local target="${1:-all}"
    shift || true
    prepare_env
    require_stack_up || die "start the stack first: pnpm run dev:stack"

    # -T: no TTY, so the test reporters keep their non-interactive formatting.
    case "$target" in
        backend)
            compose run --rm -T --no-deps backend pnpm --filter catalyst-backend run test "$@"
            ;;
        frontend)
            compose run --rm -T --no-deps frontend pnpm --filter catalyst-frontend run test -- --run "$@"
            ;;
        all)
            compose run --rm -T --no-deps backend pnpm --filter catalyst-backend run test "$@"
            compose run --rm -T --no-deps frontend pnpm --filter catalyst-frontend run test -- --run
            ;;
        *)
            die "usage: dev-stack.sh test [backend|frontend|all]"
            ;;
    esac
}

cmd_migrate() {
    prepare_env
    compose exec backend pnpm exec prisma migrate deploy --config prisma/prisma.config.ts
}

cmd_migrate_dev() {
    local name="${1:-}"
    prepare_env
    if [[ -n "$name" ]]; then
        compose exec backend pnpm exec prisma migrate dev --name "$name" --config prisma/prisma.config.ts
    else
        compose exec backend pnpm exec prisma migrate dev --config prisma/prisma.config.ts
    fi
    warn "migrations written by the container may be root-owned: sudo chown -R \"\$USER\" catalyst-backend/prisma"
}

cmd_generate() {
    prepare_env
    compose exec backend pnpm exec prisma generate --config prisma/prisma.config.ts
}

cmd_seed() {
    prepare_env
    compose exec backend pnpm run db:seed "$@"
}

cmd_seed_admin() {
    prepare_env
    compose exec backend pnpm run db:seed:admin "$@"
}

cmd_studio() {
    prepare_env
    local db_user db_pass db_name url
    db_user="$(env_or POSTGRES_USER catalyst)"
    db_pass="$(env_or POSTGRES_PASSWORD catalyst_dev)"
    db_name="$(env_or POSTGRES_DB catalyst_db)"
    url="postgresql://${db_user}:${db_pass}@localhost:${DEV_POSTGRES_PORT}/${db_name}"

    command -v pnpm >/dev/null 2>&1 || die "pnpm is required to run Prisma Studio on the host"
    info "Prisma Studio against the dev database on localhost:${DEV_POSTGRES_PORT}"
    ( cd "$ROOT_DIR" && DATABASE_URL="$url" pnpm --filter catalyst-backend run db:studio "$@" )
}

cmd_env() {
    prepare_env
    print_summary
}

cmd_help() { usage; }

# --- main --------------------------------------------------------------------
main() {
    local command="${1:-up}"
    shift || true

    case "$command" in
        help|-h|--help) detect_compose; usage; return 0 ;;
    esac

    detect_compose
    info "compose: ${COMPOSE[*]} | project: $PROJECT_NAME"

    case "$command" in
        up)          cmd_up "$@" ;;
        build)       cmd_build "$@" ;;
        rebuild)     cmd_rebuild "$@" ;;
        down|stop)   cmd_down "$@" ;;
        reset)       cmd_reset "$@" ;;
        restart)     cmd_restart "$@" ;;
        logs|log)    cmd_logs "$@" ;;
        ps|status)   cmd_ps "$@" ;;
        shell|sh)    cmd_shell "$@" ;;
        exec)        cmd_exec "$@" ;;
        run)         cmd_run "$@" ;;
        test)        cmd_test "$@" ;;
        migrate)     cmd_migrate "$@" ;;
        migrate:dev) cmd_migrate_dev "$@" ;;
        generate)    cmd_generate "$@" ;;
        seed)        cmd_seed "$@" ;;
        seed:admin)  cmd_seed_admin "$@" ;;
        studio)      cmd_studio "$@" ;;
        env)         cmd_env "$@" ;;
        *)           err "unknown command: $command"; printf '\n' >&2; usage >&2; exit 1 ;;
    esac
}

main "$@"

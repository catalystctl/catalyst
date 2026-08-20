#!/usr/bin/env bash
# scripts/benchmark/enable-fair.sh — enable benchmark fair mode (disable rate limits + external polling)
# For Catalyst: sets DISABLE_RATE_LIMIT=1 / BENCHMARK_FAIR=1 and restarts backend
# For Pterodactyl: sets APP_API_*_RATELIMIT=100000 and restarts panel
# Also disables external GitHub polling (AUTO_UPDATE_ENABLED=false)
# Usage: bash scripts/benchmark/enable-fair.sh [--restore]
set -euo pipefail

MODE="${1:-enable}" # enable or restore

log() { printf '[fair] %s\n' "$*"; }
warn() { printf '[fair] WARN: %s\n' "$*" >&2; }

# Helper to exec inside LXC
lxc_exec() {
  local lxc="$1"; shift
  lxc-attach -n "$lxc" --clear-env -- /usr/bin/env \
    PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    DEBIAN_FRONTEND=noninteractive "$@"
}

enable_catalyst() {
  log "Catalyst: enabling fair mode (DISABLE_RATE_LIMIT=1, BENCHMARK_FAIR=1)"
  # Patch /root/catalyst-docker/.env
  lxc_exec catalyst-backend bash -c '
    set -e
    ENV=/root/catalyst-docker/.env
    touch "$ENV"
    # Ensure DISABLE_RATE_LIMIT and BENCHMARK_FAIR are set
    if grep -q "^DISABLE_RATE_LIMIT=" "$ENV"; then
      sed -i "s/^DISABLE_RATE_LIMIT=.*/DISABLE_RATE_LIMIT=1/" "$ENV"
    else
      echo "DISABLE_RATE_LIMIT=1" >> "$ENV"
    fi
    if grep -q "^BENCHMARK_FAIR=" "$ENV"; then
      sed -i "s/^BENCHMARK_FAIR=.*/BENCHMARK_FAIR=1/" "$ENV"
    else
      echo "BENCHMARK_FAIR=1" >> "$ENV"
    fi
    if grep -q "^BENCHMARK_DISABLE_RATE_LIMIT=" "$ENV"; then
      sed -i "s/^BENCHMARK_DISABLE_RATE_LIMIT=.*/BENCHMARK_DISABLE_RATE_LIMIT=1/" "$ENV"
    else
      echo "BENCHMARK_DISABLE_RATE_LIMIT=1" >> "$ENV"
    fi
    # Ensure auto-update is disabled
    if grep -q "^AUTO_UPDATE_ENABLED=" "$ENV"; then
      sed -i "s/^AUTO_UPDATE_ENABLED=.*/AUTO_UPDATE_ENABLED=false/" "$ENV"
    else
      echo "AUTO_UPDATE_ENABLED=false" >> "$ENV"
    fi
    echo "--- Catalyst .env fair flags ---"
    grep -E "^(DISABLE_RATE_LIMIT|BENCHMARK|AUTO_UPDATE)" "$ENV" || true
  '
  # Patch docker-compose.yml to forward those vars to the backend container
  lxc_exec catalyst-backend bash -c '
    set -e
    COMPOSE=/root/catalyst-docker/docker-compose.yml
    # Idempotent: add env entries if missing
    for VAR in DISABLE_RATE_LIMIT BENCHMARK_FAIR BENCHMARK_DISABLE_RATE_LIMIT; do
      if ! grep -q "${VAR}:" "$COMPOSE"; then
        # Insert after API_KEY_SECRET line (known anchor)
        awk -v var="$VAR" "
          /API_KEY_SECRET:/ {print; print \"      \" var \": \${\" var \":-false}\"; next}
          {print}
        " "$COMPOSE" > /tmp/compose.tmp && mv /tmp/compose.tmp "$COMPOSE"
        echo "[fair] added $VAR to compose"
      fi
    done
    # Ensure AUTO_UPDATE_ENABLED is wired (it may already be in backend.yml but not here)
    if ! grep -q "AUTO_UPDATE_ENABLED" "$COMPOSE"; then
      awk "
        /LOG_LEVEL:/ {print; print \"      AUTO_UPDATE_ENABLED: \${AUTO_UPDATE_ENABLED:-false}\"; next}
        {print}
      " "$COMPOSE" > /tmp/compose.tmp && mv /tmp/compose.tmp "$COMPOSE"
    fi
  '
  log "Catalyst: restarting backend stack"
  lxc_exec catalyst-backend bash -c 'cd /root/catalyst-docker && docker compose up -d 2>&1 | tail -n 20'
  log "Catalyst: waiting for health"
  for i in $(seq 1 30); do
    if lxc_exec catalyst-backend bash -c 'curl -sf http://localhost:3000/health >/dev/null 2>&1'; then
      log "Catalyst: backend healthy"
      break
    fi
    sleep 2
    if [[ $i -eq 30 ]]; then warn "Catalyst: health check timed out"; fi
  done
  # Verify fair mode log
  lxc_exec catalyst-backend bash -c 'docker logs catalyst-backend --tail 20 2>&1 | grep -i "BENCHMARK FAIR" || echo "no fair log yet (may be before restart)"'
}

restore_catalyst() {
  log "Catalyst: restoring normal rate limits"
  lxc_exec catalyst-backend bash -c '
    ENV=/root/catalyst-docker/.env
    sed -i "s/^DISABLE_RATE_LIMIT=.*/DISABLE_RATE_LIMIT=false/" "$ENV" 2>/dev/null || true
    sed -i "s/^BENCHMARK_FAIR=.*/BENCHMARK_FAIR=false/" "$ENV" 2>/dev/null || true
    sed -i "s/^BENCHMARK_DISABLE_RATE_LIMIT=.*/BENCHMARK_DISABLE_RATE_LIMIT=false/" "$ENV" 2>/dev/null || true
    grep -E "^(DISABLE_RATE_LIMIT|BENCHMARK|AUTO_UPDATE)" "$ENV" || true
  '
  # Remove injected compose lines (optional, leave false values)
  lxc_exec catalyst-backend bash -c 'cd /root/catalyst-docker && docker compose up -d 2>&1 | tail -n 20'
  log "Catalyst: restarted in normal mode"
}

enable_ptero() {
  log "Pterodactyl: enabling fair mode (APP_API_*_RATELIMIT=100000)"
  lxc_exec ptero-panel bash -c '
    set -e
    COMPOSE=/root/ptero/docker-compose.yml
    ENV=/root/ptero/.env
    # Ensure .env has huge limits
    for KV in "APP_API_CLIENT_RATELIMIT=100000" "APP_API_APPLICATION_RATELIMIT=100000"; do
      KEY="${KV%%=*}"
      VAL="${KV#*=}"
      if grep -q "^${KEY}=" "$ENV" 2>/dev/null; then
        sed -i "s/^${KEY}=.*/${KEY}=${VAL}/" "$ENV"
      else
        echo "${KEY}=${VAL}" >> "$ENV"
      fi
    done
    cat "$ENV"
    echo "--- compose patch ---"
    # Patch compose to forward those vars
    for VAR in APP_API_CLIENT_RATELIMIT APP_API_APPLICATION_RATELIMIT; do
      if ! grep -q "${VAR}:" "$COMPOSE"; then
        awk -v var="$VAR" "
          /APP_SERVICE_AUTHOR:/ {print; print \"      \" var \": \${\" var \":-720}\"; next}
          {print}
        " "$COMPOSE" > /tmp/compose.tmp && mv /tmp/compose.tmp "$COMPOSE"
        echo "[fair] added $VAR to compose"
      fi
    done
    cat "$COMPOSE" | grep -A2 "APP_API"
  '
  log "Pterodactyl: restarting panel (this takes ~30s)"
  lxc_exec ptero-panel bash -c 'cd /root/ptero && docker compose up -d 2>&1 | tail -n 20'
  log "Pterodactyl: waiting for panel health"
  for i in $(seq 1 40); do
    if lxc_exec ptero-panel bash -c 'curl -sf http://localhost:80/ >/dev/null 2>&1 || curl -sf http://localhost:80 >/dev/null 2>&1'; then
      log "Pterodactyl: panel HTTP reachable"
      break
    fi
    sleep 2
  done
  # Force Laravel config cache clear inside container
  lxc_exec ptero-panel bash -c 'docker exec ptero-panel-1 php artisan config:clear 2>&1 | tail -n 10; docker exec ptero-panel-1 php artisan cache:clear 2>&1 | tail -n 10; echo "cache cleared"' || warn "cache clear failed"
  sleep 5
}

restore_ptero() {
  log "Pterodactyl: restoring normal rate limits (240/720)"
  lxc_exec ptero-panel bash -c '
    ENV=/root/ptero/.env
    sed -i "s/^APP_API_CLIENT_RATELIMIT=.*/APP_API_CLIENT_RATELIMIT=720/" "$ENV" 2>/dev/null || echo "APP_API_CLIENT_RATELIMIT=720" >> "$ENV"
    sed -i "s/^APP_API_APPLICATION_RATELIMIT=.*/APP_API_APPLICATION_RATELIMIT=240/" "$ENV" 2>/dev/null || echo "APP_API_APPLICATION_RATELIMIT=240" >> "$ENV"
    cat "$ENV"
    cd /root/ptero && docker compose up -d 2>&1 | tail -n 20
  '
  lxc_exec ptero-panel bash -c 'docker exec ptero-panel-1 php artisan config:clear 2>&1 | tail -n 5; docker exec ptero-panel-1 php artisan cache:clear 2>&1 | tail -n 5' || true
  log "Pterodactyl: restored"
}

if [[ "$MODE" == "--restore" || "$MODE" == "restore" ]]; then
  restore_catalyst
  restore_ptero
else
  enable_catalyst
  enable_ptero
  log "Fair mode enabled on both panels. External polling (auto-update) disabled."
  log "Rate limits: Catalyst 1M/min (bypass), Pterodactyl 100k/min (vs 240/720 default)"
fi

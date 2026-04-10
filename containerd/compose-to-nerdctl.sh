#!/usr/bin/env bash
set -euo pipefail

# Compose-to-nerdctl helper
# Starts Postgres and Redis under containerd (via nerdctl).

POSTGRES_CONTAINER=${POSTGRES_CONTAINER:-catalyst-postgres}
POSTGRES_IMAGE=${POSTGRES_IMAGE:-postgres:16-alpine}
POSTGRES_PORT=${POSTGRES_PORT:-5432}
POSTGRES_USER=${POSTGRES_USER:-catalyst}
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:?POSTGRES_PASSWORD must be set}
POSTGRES_DB=${POSTGRES_DB:-catalyst_db}
POSTGRES_DATA_DIR=${POSTGRES_DATA_DIR:-/var/lib/catalyst/postgres-data}

REDIS_CONTAINER=${REDIS_CONTAINER:-catalyst-redis}
REDIS_IMAGE=${REDIS_IMAGE:-redis:7-alpine}
REDIS_PORT=${REDIS_PORT:-6379}
REDIS_DATA_DIR=${REDIS_DATA_DIR:-/var/lib/catalyst/redis-data}

# Utilities
command_exists() { command -v "$1" >/dev/null 2>&1; }

if ! command_exists nerdctl; then
  echo "nerdctl is required but not installed" >&2
  exit 1
fi

mkdir -p "$POSTGRES_DATA_DIR" "$REDIS_DATA_DIR"

# No migration logic: this script only starts Postgres and Redis under nerdctl
# If you need to migrate Docker volumes to containerd, perform that as a
# one-time operation with a separate tool/script to avoid accidental data
# changes during normal service startup.

# Start Postgres if not exists
if nerdctl ps -a --format '{{.Names}}' | grep -qx "$POSTGRES_CONTAINER"; then
  echo "Container '$POSTGRES_CONTAINER' already exists. Use: nerdctl start $POSTGRES_CONTAINER"
else
  echo "Starting Postgres container: $POSTGRES_CONTAINER"
  nerdctl run -d \
    --name "$POSTGRES_CONTAINER" \
    -p "${POSTGRES_PORT}:5432" \
    -e POSTGRES_USER="$POSTGRES_USER" \
    -e POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
    -e POSTGRES_DB="$POSTGRES_DB" \
    -v "${POSTGRES_DATA_DIR}:/var/lib/postgresql/data" \
    --restart always \
    "$POSTGRES_IMAGE"
fi

# Start Redis if not exists
if nerdctl ps -a --format '{{.Names}}' | grep -qx "$REDIS_CONTAINER"; then
  echo "Container '$REDIS_CONTAINER' already exists. Use: nerdctl start $REDIS_CONTAINER"
else
  echo "Starting Redis container: $REDIS_CONTAINER"
  nerdctl run -d \
    --name "$REDIS_CONTAINER" \
    -p "${REDIS_PORT}:6379" \
    -v "${REDIS_DATA_DIR}:/data" \
    --restart always \
    "$REDIS_IMAGE"
fi

# Health checks (best-effort)
# Postgres: wait for port to open and optionally pg_isready
echo "Waiting for Postgres to accept connections on port ${POSTGRES_PORT}..."
if command_exists pg_isready; then
  for i in $(seq 1 30); do
    if pg_isready -h 127.0.0.1 -p "$POSTGRES_PORT" -U "$POSTGRES_USER" >/dev/null 2>&1; then
      echo "Postgres is accepting connections."
      break
    fi
    sleep 1
  done
else
  # Fallback: wait for TCP port to be open
  for i in $(seq 1 30); do
    if ss -ltn | awk '{print $4}' | grep -q ":${POSTGRES_PORT}$"; then
      echo "Port ${POSTGRES_PORT} is listening (Postgres likely up)."
      break
    fi
    sleep 1
  done
fi

# Redis: ping
echo "Waiting for Redis to respond on port ${REDIS_PORT}..."
if command_exists redis-cli; then
  for i in $(seq 1 30); do
    if redis-cli -p "$REDIS_PORT" ping >/dev/null 2>&1; then
      echo "Redis responded to PING."
      break
    fi
    sleep 1
  done
else
  for i in $(seq 1 30); do
    if ss -ltn | awk '{print $4}' | grep -q ":${REDIS_PORT}$"; then
      echo "Port ${REDIS_PORT} is listening (Redis likely up)."
      break
    fi
    sleep 1
  done
fi

cat <<EOF

Setup complete.
- Postgres container: $POSTGRES_CONTAINER (port ${POSTGRES_PORT})
  Data dir: $POSTGRES_DATA_DIR
- Redis container: $REDIS_CONTAINER (port ${REDIS_PORT})
  Data dir: $REDIS_DATA_DIR

Notes:
- This script does not perform Docker -> containerd data migrations.
- This script is idempotent: it won't recreate containers that already exist.

EOF

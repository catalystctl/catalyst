#!/bin/sh
# Catalyst Backend - Docker Entrypoint
# Auto-runs database migrations on startup

set -e

echo "==> Catalyst Backend starting..."

# Join the docker.sock group so the panel Update button can talk to the host
# daemon after we drop root. No-op when the socket is not mounted.
if [ "$(id -u)" = "0" ] && [ -S /var/run/docker.sock ]; then
    sock_gid="$(stat -c '%g' /var/run/docker.sock 2>/dev/null || true)"
    if [ -n "$sock_gid" ]; then
        if ! getent group "$sock_gid" >/dev/null 2>&1; then
            addgroup -g "$sock_gid" docker >/dev/null
        fi
        sock_group="$(getent group "$sock_gid" | cut -d: -f1)"
        addgroup catalyst "$sock_group" >/dev/null 2>&1 || true
    fi
    # Image /root is 0700. A same-path bind of /root/catalyst-docker is
    # unreachable unless parents are traversable by user catalyst.
    compose_path="${AUTO_UPDATE_DOCKER_COMPOSE_PATH:-}"
    if [ -n "$compose_path" ]; then
        dir=$(dirname "$compose_path")
        while [ "$dir" != "/" ]; do
            chmod o+x "$dir" 2>/dev/null || true
            dir=$(dirname "$dir")
        done
    fi
fi

# Ensure data directories exist (volumes may be mounted over the Dockerfile-created dirs)
mkdir -p /var/lib/catalyst/servers \
         /var/lib/catalyst/backups \
         /var/lib/catalyst/plugins \
         /tmp/catalyst-backup-stream \
         /tmp/catalyst-backup-transfer
if [ "$(id -u)" = "0" ]; then
    chown -R catalyst:catalyst /var/lib/catalyst /tmp/catalyst-backup-stream /tmp/catalyst-backup-transfer 2>/dev/null || true
fi
# Run pending migrations (non-destructive — safe to run on every start).
# NEVER fall back to `prisma db push --accept-data-loss` unless the operator
# explicitly sets ALLOW_DATA_LOSS=1 (destructive schema repair only).
#
# Prefer the image-local Prisma CLI (shipped in node_modules) over `npx`, which
# may attempt a network fetch when the package is missing and fails offline.
run_prisma() {
    if command -v prisma >/dev/null 2>&1; then
        prisma "$@"
    elif [ -x ./node_modules/.bin/prisma ]; then
        ./node_modules/.bin/prisma "$@"
    elif [ -f ./node_modules/prisma/build/index.js ]; then
        node ./node_modules/prisma/build/index.js "$@"
    else
        echo "==> Error: prisma CLI not found in image" >&2
        return 127
    fi
}

if [ -n "$DATABASE_URL" ]; then
    echo "==> Running database migrations..."
    if run_prisma migrate deploy --config prisma/prisma.config.ts; then
        echo "==> Migrations complete."
    else
        if [ "${ALLOW_DATA_LOSS:-0}" = "1" ]; then
            echo "==> migrate deploy failed; ALLOW_DATA_LOSS=1 set — running prisma db push --accept-data-loss"
            run_prisma db push --config prisma/prisma.config.ts --accept-data-loss || \
                echo "==> Warning: db push also failed. Manual intervention required."
        else
            echo "==> Warning: migrate deploy failed. Refusing destructive db push."
            echo "==> Set ALLOW_DATA_LOSS=1 to allow prisma db push --accept-data-loss, or fix migrations manually."
            echo "==> If this is a fresh database, run db:seed / migrate manually."
        fi
    fi
else
    echo "==> Warning: DATABASE_URL not set, skipping migrations."
fi

# Drop to catalyst after migrations. docker.sock membership is already applied.
if [ "$(id -u)" = "0" ]; then
    exec su-exec catalyst "$@"
fi
exec "$@"

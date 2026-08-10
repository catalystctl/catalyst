#!/bin/sh
# Catalyst Backend - Docker Entrypoint
# Auto-runs database migrations on startup

set -e

echo "==> Catalyst Backend starting..."

# Ensure data directories exist (volumes may be mounted over the Dockerfile-created dirs)
mkdir -p /var/lib/catalyst/servers \
         /var/lib/catalyst/backups \
         /var/lib/catalyst/plugins \
         /tmp/catalyst-backup-stream \
         /tmp/catalyst-backup-transfer

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

# Execute the main command
exec "$@"

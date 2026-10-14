#!/bin/sh
# =============================================================================
# Catalyst - backend container entrypoint (development)
#
# Runs on every start of the `backend` service in docker-compose.dev.yml:
#
#   1. create the data directories a volume mount may have shadowed
#   2. regenerate the Prisma client if the mounted schema is newer than it
#      (e.g. after a `git pull` that touched schema.prisma)
#   3. apply committed migrations - non-destructive, safe on every start
#   4. hand over to the watch-mode dev server
#
# Shell: /bin/sh (Alpine) - keep it POSIX.
# =============================================================================
set -e

mkdir -p /var/lib/catalyst/servers \
         /var/lib/catalyst/backups \
         /var/lib/catalyst/plugins \
         /tmp/catalyst-backup-stream \
         /tmp/catalyst-backup-transfer

PRISMA_CLIENT="/app/node_modules/.prisma/client/index.js"
if [ -f "$PRISMA_CLIENT" ] && [ prisma/schema.prisma -nt "$PRISMA_CLIENT" ]; then
    echo "==> prisma/schema.prisma is newer than the generated client - regenerating..."
    pnpm exec prisma generate --config prisma/prisma.config.ts
fi

echo "==> Applying committed migrations (prisma migrate deploy)..."
if ! pnpm exec prisma migrate deploy --config prisma/prisma.config.ts; then
    echo "" >&2
    echo "==> ERROR: prisma migrate deploy failed." >&2
    echo "    A dev database created with 'prisma db push' cannot be migrated in" >&2
    echo "    place. Reset it with:  pnpm run dev:stack:reset" >&2
    echo "    Or author the missing migration with:" >&2
    echo "      pnpm run dev:stack:migrate:dev <name>" >&2
    exit 1
fi

echo "==> Starting the backend dev server (tsx --watch)..."
exec pnpm run dev

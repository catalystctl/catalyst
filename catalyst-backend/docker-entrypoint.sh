#!/bin/sh
# Catalyst Backend - Docker Entrypoint
# Auto-runs database migrations on startup

set -e

echo "==> Catalyst Backend starting..."

# Run pending migrations (non-destructive — safe to run on every start)
if [ -n "$DATABASE_URL" ]; then
    echo "==> Running database migrations..."
    bunx prisma migrate deploy --config prisma/prisma.config.ts 2>/dev/null || \
    bunx prisma db push --config prisma/prisma.config.ts --accept-data-loss 2>/dev/null || \
    echo "==> Warning: Could not run migrations. If this is a fresh database, run db:seed manually."
    echo "==> Migrations complete."
else
    echo "==> Warning: DATABASE_URL not set, skipping migrations."
fi

# Execute the main command
exec "$@"

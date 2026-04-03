#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND_DIR="$ROOT_DIR/catalyst-backend"

usage() {
  cat <<'USAGE'
Usage: scripts/clear-all-servers.sh [--yes]

Deletes ALL server records from the database and removes local containers
and mount directories for each server.

Options:
  --yes   Skip confirmation prompt.
USAGE
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ ! -d "$BACKEND_DIR" ]]; then
  echo "Backend directory not found: $BACKEND_DIR" >&2
  exit 1
fi

if [[ -f "$BACKEND_DIR/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$BACKEND_DIR/.env"
  set +a
fi

SERVER_DATA_PATH="${SERVER_DATA_PATH:-/tmp/catalyst-servers}"

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is not set. Ensure catalyst-backend/.env is present." >&2
  exit 1
fi

echo "Fetching server list from database..."

server_list="$(
  cd "$BACKEND_DIR"
  bun <<'NODE'
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
(async () => {
  const servers = await prisma.server.findMany({
    select: { id: true, uuid: true },
  });
  for (const server of servers) {
    console.log(`${server.id}\t${server.uuid}`);
  }
  await prisma.$disconnect();
})().catch(async (err) => {
  console.error(err);
  try { await prisma.$disconnect(); } catch {}
  process.exit(1);
});
NODE
)"

if [[ "${1:-}" != "--yes" ]]; then
  echo "This will DELETE ALL server records from the database, remove ALL containers"
  echo "in the catalyst namespace via nerdctl, and delete ALL directories under:"
  echo "  $SERVER_DATA_PATH"
  read -r -p "Type DELETE_LOCAL to continue: " confirm_local
  if [[ "$confirm_local" != "DELETE_LOCAL" ]]; then
    echo "Aborted."
    exit 1
  fi
fi

echo "Removing containers and mount directories..."
if command -v nerdctl >/dev/null 2>&1; then
  mapfile -t containers < <(nerdctl --namespace catalyst ps -a --format '{{.ID}}')
  if [[ "${#containers[@]}" -gt 0 ]]; then
    nerdctl --namespace catalyst rm -f "${containers[@]}" || true
  fi
else
  echo "  nerdctl not found; skipping container removal."
fi

if [[ -d "$SERVER_DATA_PATH" ]]; then
  find "$SERVER_DATA_PATH" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
fi

echo "Deleting server records from database..."
(
  cd "$BACKEND_DIR"
  bun <<'NODE'
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
(async () => {
  const result = await prisma.server.deleteMany();
  console.log(`Deleted ${result.count} servers.`);
  await prisma.$disconnect();
})().catch(async (err) => {
  console.error(err);
  try { await prisma.$disconnect(); } catch {}
  process.exit(1);
});
NODE
)

echo "Done."

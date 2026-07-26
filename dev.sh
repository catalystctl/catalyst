#!/bin/bash
# Catalyst - Quick Start
# Sets up and runs Catalyst via Docker Compose

set -e

echo "╔════════════════════════════════════════════════════════════╗"
echo "║           Catalyst — Docker Compose Setup                 ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

# Check for docker compose
if command -v docker >/dev/null 2>&1; then
    DOCKER_COMPOSE="docker compose"
elif command -v podman >/dev/null 2>&1; then
    DOCKER_COMPOSE="podman compose"
else
    echo "Error: docker or podman is required."
    echo "  Install Docker: https://docs.docker.com/get-docker/"
    echo "  Or Podman:     https://podman.io/getting-started"
    exit 1
fi

# Create .env from example if it doesn't exist
if [ ! -f .env ]; then
    cp .env.example .env
    echo "Created .env from .env.example"
    echo ""
    echo "⚠  Edit .env and set at minimum:"
    echo "     BETTER_AUTH_SECRET  (openssl rand -base64 32)"
    echo "     POSTGRES_PASSWORD"
    echo ""
    read -rp "Press Enter to continue once you've edited .env, or Ctrl+C to abort..."
fi

# Validate required vars
source .env 2>/dev/null || true
if [ -z "$BETTER_AUTH_SECRET" ] || [ "$BETTER_AUTH_SECRET" = "your-super-secret-better-auth-key" ]; then
    echo "Error: BETTER_AUTH_SECRET is not set in .env"
    echo "  Generate one: openssl rand -base64 32"
    exit 1
fi
if [ -z "$POSTGRES_PASSWORD" ]; then
    echo "Error: POSTGRES_PASSWORD is not set in .env"
    exit 1
fi

echo "Starting Catalyst..."
echo ""

# Build and start all services
$DOCKER_COMPOSE up -d --build

echo ""
echo "╔════════════════════════════════════════════════════════════╗"
echo "║                  Catalyst is running!                     ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""
echo "  Panel:    http://localhost${FRONTEND_PORT:+:$FRONTEND_PORT}"
echo "  API:      http://localhost:3000/api"
echo "  Docs:     http://localhost:3000/docs"
echo "  SFTP:     localhost:2022"
echo ""
echo "  First-time setup: seed the database with"
echo "    docker compose exec backend bun run db:seed"
echo ""
echo "  View logs:  docker compose logs -f"
echo "  Stop:       docker compose down"
echo "  Reset:      docker compose down -v"
echo ""

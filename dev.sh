#!/bin/bash
# Catalyst - Development bootstrap script
# Sets up all components for local development (Bun monorepo)

set -e

echo "╔════════════════════════════════════════════════════════════╗"
echo "║           Catalyst Development Setup                      ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

# Check prerequisites
check_cmd() {
    if ! command -v "$1" >/dev/null 2>&1; then
        echo "✗ $1 is not installed"
        return 1
    fi
    echo "✓ $1 found: $(command -v "$1")"
}

echo "Checking prerequisites..."
check_cmd docker
check_cmd docker-compose || check_cmd "docker compose"
check_cmd bun
echo ""

# Start database services
echo "Starting database services..."
docker compose -f docker-compose.yml up -d 2>/dev/null || docker-compose up -d

# Wait for postgres to be ready
echo "Waiting for PostgreSQL..."
for i in $(seq 1 30); do
    if docker exec catalyst-postgres pg_isready -U catalyst >/dev/null 2>&1; then
        echo "✓ PostgreSQL is ready"
        break
    fi
    if [ "$i" -eq 30 ]; then
        echo "✗ PostgreSQL did not become ready in time"
        exit 1
    fi
    sleep 1
done

# Install all workspace dependencies
echo ""
echo "Installing workspace dependencies..."
bun install
echo "✓ Workspace install complete"

# Backend env
if [ ! -f catalyst-backend/.env ]; then
    cp catalyst-backend/.env.example catalyst-backend/.env
    echo "  Created catalyst-backend/.env from .env.example"
fi

# Frontend env
if [ ! -f catalyst-frontend/.env ]; then
    cp catalyst-frontend/.env.example catalyst-frontend/.env
    echo "  Created catalyst-frontend/.env from .env.example"
fi

# Database setup
echo ""
echo "Setting up database..."
bun run db:generate
bun run db:push
bun run db:seed
echo "✓ Database setup complete"

# Build agent (optional — only if Rust is available)
if command -v cargo >/dev/null 2>&1; then
    echo ""
    echo "Building Catalyst Agent..."
    cd catalyst-agent && cargo build && cd ..
    echo "✓ Agent build complete"
else
    echo ""
    echo "⚠ Rust/cargo not found — skipping agent build"
fi

echo ""
echo "╔════════════════════════════════════════════════════════════╗"
echo "║                  Setup Complete!                          ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""
echo "Start everything with a single command:"
echo "  bun run dev"
echo ""
echo "Or start individual services:"
echo "  bun run dev:infra      # Docker (Postgres + Redis)"
echo "  bun run dev:agent      # Rust agent (requires cargo)"
echo "  cd catalyst-backend && bun run dev"
echo "  cd catalyst-frontend && bun run dev"
echo ""
echo "Open http://localhost:5173 in your browser."
echo ""

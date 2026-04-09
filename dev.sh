#!/bin/bash
# Catalyst - Development bootstrap script
# Sets up all components for local development

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
check_cmd bun || check_cmd npm
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

# Backend setup
echo ""
echo "Setting up backend..."
cd catalyst-backend
if [ ! -f .env ]; then
    cp .env.example .env
    echo "  Created .env from .env.example"
fi

if command -v bun >/dev/null 2>&1; then
    bun install
    bun run db:generate
    bun run db:push
    bun run db:seed
else
    npm install
    npx prisma generate
    npm run db:push
    npm run db:seed
fi
cd ..
echo "✓ Backend setup complete"

# Frontend setup
echo ""
echo "Setting up frontend..."
cd catalyst-frontend
if [ ! -f .env ]; then
    cp .env.example .env
    echo "  Created .env from .env.example"
fi

if command -v bun >/dev/null 2>&1; then
    bun install
else
    npm install
fi
cd ..
echo "✓ Frontend setup complete"

echo ""
echo "╔════════════════════════════════════════════════════════════╗"
echo "║                  Setup Complete!                          ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""
echo "Start development servers:"
echo "  Backend:  cd catalyst-backend && bun run dev"
echo "  Frontend: cd catalyst-frontend && bun run dev"
echo ""
echo "Open http://localhost:5173 in your browser."
echo ""

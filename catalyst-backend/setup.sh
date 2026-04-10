#!/bin/bash

# Catalyst Backend Setup Script
# Initializes database and seeds with example data
# WARNING: For development only. Do NOT use in production.

set -e

echo "=== Catalyst Backend Setup ==="
echo "⚠ WARNING: This script is for development environments only."
echo "  It creates default admin credentials. Change them after first login."
echo ""

# Check if running in production
if [ "${NODE_ENV:-}" = "production" ]; then
    echo "ERROR: This setup script must not be run in production."
    echo "In production, use: npm run db:migrate and configure users manually."
    exit 1
fi

# Check dependencies
if ! command -v bun &> /dev/null; then
    echo "Error: Bun is not installed"
    echo "Install Bun: curl -fsSL https://bun.sh/install | bash"
    exit 1
fi

# Install dependencies
echo "Installing dependencies..."
bun install

# Wait for database
echo "Waiting for database..."
sleep 5

# Run migrations
echo "Running database migrations..."
bun run db:push

# Seed database with sample data
echo "Seeding database..."
bun run db:seed

echo ""
echo "✓ Setup complete."
echo "⚠ Remember to change the default admin password after first login!"
echo ""
echo "Starting backend..."
bun run dev

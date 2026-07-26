#!/bin/bash

# Catalyst Backend - Local Development Setup

set -e

echo "Setting up Catalyst Backend for local development..."

cd "$(dirname "$0")"

# Create .env if it doesn't exist
if [ ! -f .env ]; then
    cp .env.example .env
    echo "Created .env file"
fi

# Install dependencies
echo "Installing dependencies..."
bun install

# Generate Prisma Client
echo "Generating Prisma Client..."
bun run db:generate

# Push schema to database
echo "Pushing database schema..."
bun run db:push

# Seed database
echo "Seeding database..."
bun run db:seed

echo ""
echo "✓ Backend setup complete!"
echo ""
echo "Start the development server:"
echo "  bun run dev"
echo ""
echo "View database:"
echo "  bun run db:studio"
echo ""

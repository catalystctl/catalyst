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
pnpm install

# Generate Prisma Client
echo "Generating Prisma Client..."
pnpm run db:generate

# Push schema to database
echo "Pushing database schema..."
pnpm run db:push

# Seed database
echo "Seeding database..."
pnpm run db:seed

echo ""
echo "✓ Backend setup complete!"
echo ""
echo "Start the development server:"
echo "  pnpm run dev"
echo ""
echo "View database:"
echo "  pnpm run db:studio"
echo ""

#!/bin/bash

# Catalyst Backend Setup Script
# Initializes database and seeds with example data

set -e

echo "=== Catalyst Backend Setup ==="

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

cat > seed.sql << 'EOF'
-- Create initial user
INSERT INTO "User" (id, email, username, password, "createdAt", "updatedAt")
VALUES (
    'user_admin',
    'admin@example.com',
    'admin',
    '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcg7b3XeKeUxWdeS86E36XQZfsm',  -- password: admin123
    NOW(),
    NOW()
) ON CONFLICT DO NOTHING;

-- Create location
INSERT INTO "Location" (id, name, description, "createdAt")
VALUES (
    'loc_us_east',
    'US East 1',
    'US East Coast Data Center',
    NOW()
) ON CONFLICT DO NOTHING;

-- Create role
INSERT INTO "Role" (id, name, description, permissions, "createdAt", "updatedAt")
VALUES (
    'role_admin',
    'Administrator',
    'Full system access',
    ARRAY['server.start', 'server.stop', 'server.read', 'file.read', 'file.write', 'console.read', 'console.write', 'server.create', 'server.delete'],
    NOW(),
    NOW()
) ON CONFLICT DO NOTHING;

-- Create Minecraft template
INSERT INTO "ServerTemplate" (
    id, name, description, author, version, image, startup, "stopCommand", "sendSignalTo",
    variables, "supportedPorts", "allocatedMemoryMb", "allocatedCpuCores", features, "createdAt", "updatedAt"
)
VALUES (
    'tpl_minecraft_paper',
    'Minecraft Server (Paper)',
    'High-performance Minecraft server running Paper',
    'Catalyst Maintainers',
    '1.20.4',
    'itzg/minecraft-server:latest',
    'java -Xmx{{MEMORY}}M -Xms{{MEMORY}}M -jar paper.jar nogui',
    'say SERVER STOPPING',
    'SIGTERM',
    '[
        {
            "name": "MEMORY",
            "description": "RAM in MB",
            "default": "1024",
            "required": true,
            "input": "number"
        },
        {
            "name": "EULA",
            "description": "Agree to Minecraft EULA",
            "default": "true",
            "required": true,
            "input": "checkbox"
        }
    ]'::json,
    ARRAY[25565],
    1024,
    2,
    '{"restartOnExit": true}'::json,
    NOW(),
    NOW()
) ON CONFLICT DO NOTHING;
EOF

psql "$DATABASE_URL" -f seed.sql
rm seed.sql

echo "✓ Database initialized and seeded"
echo "✓ Admin user created: admin@example.com (password: admin123)"
echo "✓ Minecraft template available"
echo ""
echo "Starting backend..."
bun run dev

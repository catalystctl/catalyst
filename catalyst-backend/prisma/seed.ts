// Catalyst Backend - Prisma Seed Script
// Initializes database with example data

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { auth } from "../src/auth";

// Prisma v7: Use adapter for PostgreSQL
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("Seeding database...");

  // Create location
  const location = await prisma.location.upsert({
    where: { name: "US East 1" },
    update: {},
    create: {
      name: "US East 1",
      description: "US East Coast Data Center",
    },
  });

  console.log("✓ Location created");

  // Create node
  const node = await prisma.node.upsert({
    where: { name: "production-1" },
    update: {},
    create: {
      name: "production-1",
      description: "Production game server node",
      locationId: location.id,
      hostname: "node1.example.com",
      publicAddress: "192.168.1.100",
      secret: "dev-secret-key-12345",
      maxMemoryMb: 32000,
      maxCpuCores: 16,
    },
  });

  console.log("✓ Node created");

  // Create admin user via better-auth API
  // This ensures password is properly hashed and stored in the account table
  let user = await prisma.user.findUnique({
    where: { email: "admin@example.com" },
  });

  if (!user) {
    const signUpResponse = await auth.api.signUpEmail({
      headers: new Headers({
        origin: process.env.FRONTEND_URL || "http://localhost:5173",
      }),
      body: {
        email: "admin@example.com",
        password: "admin123",
        name: "admin",
        username: "admin",
      } as any,
      returnHeaders: true,
    });

    const data =
      "headers" in signUpResponse && signUpResponse.response
        ? signUpResponse.response
        : (signUpResponse as any);
    user = data?.user;
  }

  if (!user) {
    throw new Error("Failed to create admin user via better-auth");
  }

  // Mark email as verified for development
  await prisma.user.update({
    where: { id: user.id },
    data: { emailVerified: true },
  });

  console.log("✓ Admin user created (admin@example.com / admin123)");

  // Create admin role
  const adminRole = await prisma.role.upsert({
    where: { name: "Administrator" },
    update: {
      description: "Full system access",
      permissions: ["*"],
    },
    create: {
      name: "Administrator",
      description: "Full system access",
      permissions: ["*"],
    },
  });

  console.log("✓ Administrator role created");

  // Create moderator role
  const moderatorRole = await prisma.role.upsert({
    where: { name: "Moderator" },
    update: {
      description: "Limited management permissions",
      permissions: [
        "node.read",
        "node.update",
        "node.view_stats",
        "location.read",
        "template.read",
        "user.read",
        "server.read",
        "server.start",
        "server.stop",
        "file.read",
        "file.write",
        "console.read",
        "console.write",
        "alert.read",
        "alert.create",
        "alert.update",
        "alert.delete",
      ],
    },
    create: {
      name: "Moderator",
      description: "Limited management permissions",
      permissions: [
        "node.read",
        "node.update",
        "node.view_stats",
        "location.read",
        "template.read",
        "user.read",
        "server.read",
        "server.start",
        "server.stop",
        "file.read",
        "file.write",
        "console.read",
        "console.write",
        "alert.read",
        "alert.create",
        "alert.update",
        "alert.delete",
      ],
    },
  });

  console.log("✓ Moderator role created");

  // Create user role
  const userRole = await prisma.role.upsert({
    where: { name: "User" },
    update: {
      description: "Basic user permissions",
      permissions: ["server.read"],
    },
    create: {
      name: "User",
      description: "Basic user permissions",
      permissions: ["server.read"],
    },
  });

  console.log("✓ User role created");

  // Assign admin role to user
  await prisma.user.update({
    where: { id: user.id },
    data: {
      role: "administrator",
      roles: {
        connect: { id: adminRole.id },
      },
    },
  });

  console.log("✓ Admin role assigned to default user");

  // Create Minecraft template
  const minecraftTemplate = await prisma.serverTemplate.upsert({
    where: { name: "Minecraft Server (Paper)" },
    update: {},
    create: {
      name: "Minecraft Server (Paper)",
      description: "High-performance Minecraft server running Paper",
      author: "Catalyst Maintainers",
      version: "1.20.4",
      image: "itzg/minecraft-server:latest",
      images: [
        { name: "temurin-25", label: "Eclipse Temurin 25 JRE", image: "eclipse-temurin:25-jre" },
        { name: "temurin-21", label: "Eclipse Temurin 21 JRE", image: "eclipse-temurin:21-jre" },
        { name: "temurin-17", label: "Eclipse Temurin 17 JRE", image: "eclipse-temurin:17-jre" },
        { name: "temurin-11", label: "Eclipse Temurin 11 JRE", image: "eclipse-temurin:11-jre" },
        { name: "temurin-8", label: "Eclipse Temurin 8 JRE", image: "eclipse-temurin:8-jre" },
      ],
      defaultImage: "eclipse-temurin:21-jre",
      startup:
        "java -Xmx{{MEMORY}}M -Xms{{MEMORY}}M -XX:+UseG1GC -jar paper.jar nogui",
      stopCommand: "say SERVER STOPPING",
      sendSignalTo: "SIGTERM",
      variables: [
        {
          name: "MEMORY",
          description: "Amount of RAM in MB",
          default: "1024",
          required: true,
          input: "number",
        },
        {
          name: "EULA",
          description: "Agree to Minecraft EULA",
          default: "true",
          required: true,
          input: "checkbox",
        },
      ],
      supportedPorts: [25565],
      allocatedMemoryMb: 1024,
      allocatedCpuCores: 2,
      features: {
        restartOnExit: true,
      },
    },
  });

  console.log("✓ Minecraft template created");

  // Create generic Node.js template
  await prisma.serverTemplate.upsert({
    where: { name: "Node.js Bot (Git Repository)" },
    update: {},
    create: {
      name: "Node.js Bot (Git Repository)",
      description:
        "Generic Node.js template that clones a Git repository, installs dependencies, and starts via .env command overrides.",
      author: "Catalyst Maintainers",
      version: "1.0.0",
      image: "node:20-bookworm-slim",
      images: [
        { name: "node-22", label: "Node.js 22", image: "node:22-bookworm-slim" },
        { name: "node-20", label: "Node.js 20 (LTS)", image: "node:20-bookworm-slim" },
        { name: "node-18", label: "Node.js 18", image: "node:18-bookworm-slim" },
      ],
      defaultImage: "node:20-bookworm-slim",
      installImage: "node:20-bookworm-slim",
      startup:
        "sh -lc 'set -a; [ -f .env ] && . ./.env; set +a; CMD=\"${BOT_START_COMMAND:-${START_COMMAND:-npm start}}\"; echo \"[Catalyst] Startup command: $CMD\"; exec sh -lc \"$CMD\"'",
      stopCommand: "exit",
      sendSignalTo: "SIGTERM",
      variables: [
        {
          name: "GIT_REPO",
          description: "Git clone URL for your bot repository",
          default: "",
          required: true,
          input: "text",
        },
        {
          name: "GIT_BRANCH",
          description: "Git branch or tag to deploy",
          default: "main",
          required: false,
          input: "text",
        },
        {
          name: "NPM_INSTALL_COMMAND",
          description: "Dependency install command run after clone",
          default: "npm install --no-audit --no-fund",
          required: false,
          input: "text",
        },
        {
          name: "START_COMMAND",
          description: "Fallback startup command when BOT_START_COMMAND is not set",
          default: "npm start",
          required: false,
          input: "text",
        },
        {
          name: "BOT_START_COMMAND",
          description: "Optional startup command override (also supports .env value)",
          default: "",
          required: false,
          input: "text",
        },
        {
          name: "PORT",
          description: "Application listen port (kept in sync with server primary port on start)",
          default: "3000",
          required: true,
          input: "number",
          rules: ["between:1024,65535"],
        },
        {
          name: "NODE_ENV",
          description: "Node.js runtime environment",
          default: "production",
          required: false,
          input: "text",
        },
      ],
      installScript: `#!/bin/sh
set -e

echo '[Catalyst] Starting Node.js bot installation...'

if ! command -v git >/dev/null 2>&1; then
  echo '[Catalyst] ERROR: git is required but not installed on this node.'
  exit 1
fi

# Prefer host npm; fallback to a containerized install if npm is unavailable.
run_dependency_install() {
  if command -v npm >/dev/null 2>&1; then
    sh -lc "$INSTALL_CMD"
    return
  fi

  echo '[Catalyst] npm not found on host; using containerized dependency install.'

  NODE_IMAGE="{{TEMPLATE_IMAGE}}"
  if [ -z "$NODE_IMAGE" ] || [ "$NODE_IMAGE" = "{{TEMPLATE_IMAGE}}" ]; then
    NODE_IMAGE="node:20-bookworm-slim"
  fi

  if command -v nerdctl >/dev/null 2>&1; then
    nerdctl run --rm -v "{{SERVER_DIR}}:/data" -w /data "$NODE_IMAGE" sh -lc "$INSTALL_CMD"
    return
  fi

  if command -v docker >/dev/null 2>&1; then
    docker run --rm -v "{{SERVER_DIR}}:/data" -w /data "$NODE_IMAGE" sh -lc "$INSTALL_CMD"
    return
  fi

  if command -v podman >/dev/null 2>&1; then
    podman run --rm -v "{{SERVER_DIR}}:/data" -w /data "$NODE_IMAGE" sh -lc "$INSTALL_CMD"
    return
  fi

  echo '[Catalyst] ERROR: npm not found and no container runtime (nerdctl/docker/podman) is available.'
  exit 1
}

REPO_URL="{{GIT_REPO}}"
BRANCH="{{GIT_BRANCH}}"
INSTALL_CMD="{{NPM_INSTALL_COMMAND}}"

if [ -z "$REPO_URL" ]; then
  echo '[Catalyst] ERROR: GIT_REPO is required.'
  exit 1
fi

if [ -z "$BRANCH" ]; then
  BRANCH="main"
fi

if [ -z "$INSTALL_CMD" ]; then
  INSTALL_CMD="npm install --no-audit --no-fund"
fi

mkdir -p {{SERVER_DIR}}
cd {{SERVER_DIR}}

if [ -d .git ]; then
  echo '[Catalyst] Existing repository detected, resetting to requested branch.'
  git remote set-url origin "$REPO_URL"
  git fetch --depth 1 origin "$BRANCH"
  git checkout -B "$BRANCH" "origin/$BRANCH"
  git reset --hard "origin/$BRANCH"
else
  if [ "$(ls -A . 2>/dev/null)" ]; then
    echo '[Catalyst] Existing files found. Cleaning server directory before clone.'
    find . -mindepth 1 -maxdepth 1 -exec rm -rf {} +
  fi
  echo "[Catalyst] Cloning $REPO_URL (branch: $BRANCH)..."
  git clone --depth 1 --branch "$BRANCH" "$REPO_URL" .
fi

if [ ! -f package.json ]; then
  echo '[Catalyst] ERROR: package.json not found after clone.'
  exit 1
fi

echo "[Catalyst] Running dependency install: $INSTALL_CMD"
run_dependency_install

if [ ! -f .env ]; then
  cat > .env << 'ENVEOF'
# Optional runtime overrides
# BOT_START_COMMAND=npm start
# START_COMMAND=npm start
# PORT=3000
# NODE_ENV=production
ENVEOF
  echo '[Catalyst] Created default .env file (edit as needed).'
fi

echo '[Catalyst] Node.js bot installation complete.'
`,
      supportedPorts: [3000],
      allocatedMemoryMb: 1024,
      allocatedCpuCores: 1,
      features: {
        restartOnExit: true,
      },
    },
  });

  console.log("✓ Node.js template created");

  console.log("\nSeeding complete!");
  console.log("Default user: admin@example.com / admin123");
  console.log("Production node ready at: node1.example.com");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

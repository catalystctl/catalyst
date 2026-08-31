# Catalyst Backend - Multi-stage Dockerfile
# Stage 1: Builder - installs all deps, generates Prisma client, compiles TypeScript
FROM node:22-alpine AS builder

# Enable pnpm via corepack
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Install build dependencies (needed for native modules like ssh2)
RUN apk add --no-cache python3 make g++

# Create a minimal monorepo root so pnpm can resolve workspace dependencies.
# The root pnpm-lock.yaml + .npmrc + pnpm-workspace.yaml drive the install,
# but only the backend workspace is materialised in the image.
# devDeps here must match the root package.json specifiers — pnpm
# --frozen-lockfile validates the lockfile specifiers match the manifest.
COPY pnpm-lock.yaml .npmrc ./
COPY pnpm-workspace.yaml ./
RUN printf '%s\n' '{"name":"catalyst","private":true,"devDependencies":{"@commitlint/cli":"^21.2.1","@commitlint/config-conventional":"^21.2.0","husky":"^9.1.7","typescript":"~6.0.3"}}' > package.json

# Copy backend manifest first for dependency-layer caching
COPY catalyst-backend/package.json ./catalyst-backend/
COPY catalyst-backend/tsconfig.json ./catalyst-backend/

# Install all dependencies (including devDeps needed for prisma generate and tsc)
RUN pnpm install --frozen-lockfile

# Copy backend source, Prisma schema, and build scripts (post-tsc ESM fixer)
COPY catalyst-backend/src ./catalyst-backend/src
COPY catalyst-backend/prisma ./catalyst-backend/prisma
COPY catalyst-backend/scripts ./catalyst-backend/scripts

# Generate Prisma Client
WORKDIR /app/catalyst-backend
RUN npx prisma generate --config prisma/prisma.config.ts

# Compile TypeScript to JavaScript
RUN pnpm run build

# ---------------------------------------------------------------------------
# Portable production package
#
# With node-linker=hoisted + shamefully-hoist=true, packages live under the
# monorepo-root /app/node_modules as symlinks into .pnpm. The previous runtime
# stage only copied /app/catalyst-backend/node_modules to /app/node_modules.
# Those relative symlinks then pointed at /node_modules/.pnpm/… (one level
# above /app) and every import failed with:
#
#   Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'dotenv'
#
# (GitHub issue #206 — one-liner install, catalyst-backend crash loop.)
#
# `pnpm deploy --prod --legacy` builds a self-contained deploy directory with
# a working node_modules tree (symlinks resolve inside the deploy dir).
# ---------------------------------------------------------------------------
WORKDIR /app
RUN CI=true pnpm --filter catalyst-backend deploy --prod --legacy /app/deploy

# Use the compiled dist (and not the TypeScript sources pnpm deploy copies).
RUN rm -rf /app/deploy/dist /app/deploy/src \
 && cp -a /app/catalyst-backend/dist /app/deploy/dist

# Prisma generate writes the engine cache under the builder's .pnpm store.
# Re-materialise it next to @prisma/client and at the deploy root so both
# Node resolution paths work at runtime.
RUN set -eu; \
    ENGINE_DIR="$(find /app/node_modules -path '*/.prisma/client' -type d 2>/dev/null | head -1)"; \
    echo "Prisma engine dir: ${ENGINE_DIR:-MISSING}"; \
    if [ -z "${ENGINE_DIR}" ] || [ ! -d "${ENGINE_DIR}" ]; then \
      echo "ERROR: prisma generate did not produce a .prisma/client cache"; \
      exit 1; \
    fi; \
    CLIENT_PKG="$(find /app/deploy/node_modules -path '*/@prisma/client/package.json' 2>/dev/null | head -1 | xargs -r dirname)"; \
    echo "Deploy @prisma/client: ${CLIENT_PKG:-MISSING}"; \
    if [ -z "${CLIENT_PKG}" ] || [ ! -d "${CLIENT_PKG}" ]; then \
      echo "ERROR: @prisma/client missing from deploy tree"; \
      exit 1; \
    fi; \
    mkdir -p "$(dirname "${CLIENT_PKG}")/.prisma" /app/deploy/node_modules/.prisma; \
    cp -aL "${ENGINE_DIR}/." "$(dirname "${CLIENT_PKG}")/.prisma/client/"; \
    cp -aL "${ENGINE_DIR}/." /app/deploy/node_modules/.prisma/client/

# Verify the deploy tree can resolve the packages that issue #206 crashed on,
# plus the Prisma CLI used by docker-entrypoint.sh for migrate deploy.
RUN set -eu; \
    cd /app/deploy; \
    node -e "import('dotenv').then(() => console.log('dotenv ok'))"; \
    node -e "import('fastify').then(() => console.log('fastify ok'))"; \
    node -e "import('@prisma/client').then((m) => { if (typeof m.PrismaClient !== 'function') process.exit(1); console.log('prisma client ok'); })"; \
    if [ -x ./node_modules/.bin/prisma ]; then \
      ./node_modules/.bin/prisma --version; \
    elif [ -f ./node_modules/prisma/build/index.js ]; then \
      node ./node_modules/prisma/build/index.js --version; \
    else \
      echo "ERROR: prisma CLI missing from production deploy tree"; \
      exit 1; \
    fi; \
    test -f ./dist/index.js; \
    test -f ./dist/db.js; \
    test -d ./prisma; \
    du -sh ./node_modules

FROM node:22-alpine

# curl: healthcheck. docker-cli + compose: panel Update button talks to the
# mounted docker.sock. su-exec: drop root after joining the socket group.
RUN apk add --no-cache curl docker-cli docker-cli-compose su-exec

WORKDIR /app

# Copy the self-contained deploy package (package.json, dist, prisma, node_modules)
COPY --from=builder /app/deploy/package.json ./package.json
COPY --from=builder /app/deploy/node_modules ./node_modules
COPY --from=builder /app/deploy/dist ./dist
COPY --from=builder /app/deploy/prisma ./prisma
COPY --from=builder /app/catalyst-backend/tsconfig.json ./tsconfig.json

# Copy deploy script
COPY scripts/deploy-agent.sh /scripts/deploy-agent.sh

# Create non-root user
RUN addgroup -S catalyst && adduser -S catalyst -G catalyst

# Copy entrypoint
COPY catalyst-backend/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# Create data directories
RUN mkdir -p /var/lib/catalyst/servers \
             /var/lib/catalyst/backups \
             /var/lib/catalyst/plugins \
             /tmp/catalyst-backup-stream \
             /tmp/catalyst-backup-transfer && \
    chown -R catalyst:catalyst /var/lib/catalyst /tmp/catalyst-backup-stream /tmp/catalyst-backup-transfer

# Make local bins (prisma) resolvable without relying on npx network fetches
ENV PATH="/app/node_modules/.bin:${PATH}"

# Label for GHCR consumers / one-liner install (issue #206 packaging fix)
LABEL org.opencontainers.image.source="https://github.com/catalystctl/catalyst" \
      org.opencontainers.image.description="Catalyst backend API (pnpm deploy production tree)" \
      org.opencontainers.image.licenses="MIT"

# Stay root so the entrypoint can join docker.sock's group, then su-exec to 'catalyst'.
# IAC:docker-root-user is intentional here - entrypoint drops privileges immediately after chown/docker group join.
# Hadolint/Checkov: allow root in final stage for docker.sock handling.
# sphinx:ignore iac:docker-root-user - entrypoint su-exec's to catalyst
# Expose port (SFTP is served by the node agent on 2022, not by the backend)
EXPOSE 3000

# Set production environment
ENV NODE_ENV=production

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["node", "dist/index.js"]

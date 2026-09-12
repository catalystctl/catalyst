# sphinx:ignore iac:docker-root-user - build stage runs as root intentionally (multi-stage, final is nginx:alpine non-root)
# Build stage
FROM node:22-alpine AS build

# Enable pnpm via corepack. Pinned to v10 to match the backend image and
# keep image builds deterministic (never float on pnpm@latest).
RUN corepack enable && corepack prepare pnpm@10.34.5 --activate

WORKDIR /app

# Use the root workspace lockfile for reproducible installs.
# We create a minimal workspace root containing only the frontend so
# pnpm doesn't fail when other monorepo packages aren't copied into the image.
# The devDeps listed here must match the root package.json specifiers —
# pnpm --frozen-lockfile validates that the lockfile specifiers match
# the package.json specifiers.
COPY pnpm-lock.yaml .npmrc ./
COPY pnpm-workspace.yaml ./
RUN printf '%s\n' '{"name":"catalyst","private":true,"devDependencies":{"@commitlint/cli":"^21.2.1","@commitlint/config-conventional":"^21.2.0","husky":"^9.1.7","typescript":"~6.0.3"}}' > package.json

# Copy frontend manifest first for dependency-layer caching
COPY catalyst-frontend/package.json ./catalyst-frontend/

# Install dependencies (pnpm will trim lockfile entries for missing workspaces)
RUN pnpm install --frozen-lockfile

# Copy frontend source
COPY catalyst-frontend/tsconfig.json catalyst-frontend/tsconfig.node.json ./catalyst-frontend/
COPY catalyst-frontend/vite.config.ts ./catalyst-frontend/
COPY catalyst-frontend/postcss.config.js ./catalyst-frontend/
COPY catalyst-frontend/tailwind.config.js ./catalyst-frontend/
COPY catalyst-frontend/index.html ./catalyst-frontend/
COPY catalyst-frontend/public ./catalyst-frontend/public
COPY catalyst-frontend/src ./catalyst-frontend/src

# External plugin frontends (vite alias @plugins → ../catalyst-plugins).
# Required so import.meta.glob() can compile in-tree plugins into the panel
# build: that copy shares the host React instance, so hooks work. The
# /plugins-assets/<name>/frontend.mjs runtime bundles remain the fallback for
# plugins with no build-time copy (third-party marketplace installs).
COPY catalyst-plugins ./catalyst-plugins

# Plugin frontends import @catalyst/plugin-sdk/frontend, which vite.config.ts
# aliases to the SDK source (no dist build-order dependency).
COPY packages/plugin-sdk/src ./packages/plugin-sdk/src

# Build
WORKDIR /app/catalyst-frontend
RUN pnpm run build

# Production stage — serve with nginx
FROM nginx:alpine

# Remove default config
RUN rm /etc/nginx/conf.d/default.conf

# Defaults for the two ports substituted into the config template: PORT is the
# container's own listen port, BACKEND_UPSTREAM_PORT the backend upstream port
# (set from BACKEND_INTERNAL_PORT by the compose stack). Both are overridable
# at runtime (compose passes them explicitly).
ENV PORT=80
ENV BACKEND_UPSTREAM_PORT=3000

# Copy nginx config (proxies /api, /auth, /ws, /docs to backend).
# Installed as a template: the nginx image's entrypoint renders
# /etc/nginx/templates/*.template with envsubst, substituting ${PORT}
# from the environment (backend-style PORT env var, defaults to 80).
COPY catalyst-frontend/nginx.conf /etc/nginx/templates/default.conf.template

# Copy built assets
COPY --from=build /app/catalyst-frontend/dist /usr/share/nginx/html

EXPOSE ${PORT}

CMD ["nginx", "-g", "daemon off;"]

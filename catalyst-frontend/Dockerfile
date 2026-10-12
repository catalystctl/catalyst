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
# The synthesized root manifest is derived from the real root package.json:
# pnpm --frozen-lockfile rejects specifier drift, and a hardcoded copy of
# the devDeps went stale once already (#266 renamed the typescript aliases).
COPY pnpm-lock.yaml .npmrc ./
COPY pnpm-workspace.yaml ./
COPY package.json /tmp/root-package.json
RUN node -e "const fs=require('fs');const p=require('/tmp/root-package.json');fs.writeFileSync('package.json',JSON.stringify({name:p.name,private:true,devDependencies:p.devDependencies}))"

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

# Defaults for the values substituted into the config template: PORT is the
# container's own listen port, BACKEND_UPSTREAM_PORT the backend upstream port
# (set from BACKEND_INTERNAL_PORT by the compose stack), BACKEND_HOST the
# backend hostname. All are overridable at runtime (compose passes them
# explicitly). NGINX_ENTRYPOINT_LOCAL_RESOLVERS makes the nginx image export
# NGINX_LOCAL_RESOLVERS (the nameservers from /etc/resolv.conf) so the template
# can point nginx's runtime resolver at the DNS the container actually uses.
ENV PORT=80
ENV BACKEND_UPSTREAM_PORT=3000
ENV BACKEND_HOST=backend
ENV NGINX_ENTRYPOINT_LOCAL_RESOLVERS=1

# Copy nginx config (proxies /api, /auth, /ws, /docs to backend).
# Installed as a template: the nginx image's entrypoint renders
# /etc/nginx/templates/*.template with envsubst, substituting ${PORT}
# from the environment (backend-style PORT env var, defaults to 80).
COPY catalyst-frontend/nginx.conf /etc/nginx/templates/default.conf.template

# Qualify BACKEND_HOST with a resolv.conf search domain when the short name only
# resolves that way; nginx's own resolver ignores search domains.
COPY catalyst-frontend/docker-entrypoint.d/16-backend-host.envsh /docker-entrypoint.d/16-backend-host.envsh
RUN chmod +x /docker-entrypoint.d/16-backend-host.envsh

# Copy built assets
COPY --from=build /app/catalyst-frontend/dist /usr/share/nginx/html

EXPOSE ${PORT}

CMD ["nginx", "-g", "daemon off;"]

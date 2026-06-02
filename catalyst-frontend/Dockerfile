# Build stage
FROM node:22-alpine AS build

# Enable pnpm via corepack
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Use the root workspace lockfile for reproducible installs.
# We create a minimal workspace root containing only the frontend so
# pnpm doesn't fail when other monorepo packages aren't copied into the image.
# The devDeps listed here must match the root package.json specifiers —
# pnpm --frozen-lockfile validates that the lockfile specifiers match
# the package.json specifiers.
COPY pnpm-lock.yaml .npmrc ./
COPY pnpm-workspace.yaml ./
RUN printf '%s\n' '{"name":"catalyst","private":true,"devDependencies":{"@commitlint/cli":"^21.0.2","@commitlint/config-conventional":"^21.0.2","husky":"^9.1.7","typescript":"~6.0.3"}}' > package.json

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

# Build
WORKDIR /app/catalyst-frontend
RUN pnpm run build

# Production stage — serve with nginx
FROM nginx:alpine

# Remove default config
RUN rm /etc/nginx/conf.d/default.conf

# Copy nginx config (proxies /api, /auth, /ws, /docs to backend)
COPY catalyst-frontend/nginx.conf /etc/nginx/conf.d/default.conf

# Copy built assets
COPY --from=build /app/catalyst-frontend/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]

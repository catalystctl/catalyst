# Build stage
FROM oven/bun:1.3-alpine AS build

WORKDIR /app

# Use the root workspace lockfile for reproducible installs.
# We create a minimal workspace root containing only the frontend so
# bun doesn't fail when other monorepo packages aren't copied into the image.
RUN printf '%s\n' '{"name":"catalyst","private":true,"workspaces":["catalyst-frontend"]}' > package.json
COPY bun.lock ./

# Copy frontend manifest first for dependency-layer caching
COPY catalyst-frontend/package.json ./catalyst-frontend/

# Install dependencies (bun will trim lockfile entries for missing workspaces)
RUN bun install

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
RUN bun run build

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

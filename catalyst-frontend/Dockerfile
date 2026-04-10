# Build stage
FROM oven/bun:1.3-alpine AS build

WORKDIR /app

# Copy only the frontend package (standalone build, no workspace resolution needed)
COPY catalyst-frontend/package.json catalyst-frontend/bun.lock ./
COPY catalyst-frontend/tsconfig.json catalyst-frontend/tsconfig.node.json ./
COPY catalyst-frontend/vite.config.ts ./
COPY catalyst-frontend/postcss.config.js ./
COPY catalyst-frontend/tailwind.config.js ./
COPY catalyst-frontend/index.html ./
COPY catalyst-frontend/public ./public
COPY catalyst-frontend/src ./src

# Install dependencies
RUN bun install

# Build
RUN bun run build

# Production stage — serve with nginx
FROM nginx:alpine

# Remove default config
RUN rm /etc/nginx/conf.d/default.conf

# Copy nginx config (proxies /api, /auth, /ws, /docs to backend)
COPY catalyst-frontend/nginx.conf /etc/nginx/conf.d/default.conf

# Copy built assets
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]

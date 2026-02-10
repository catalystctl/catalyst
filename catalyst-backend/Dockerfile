# Catalyst Backend - Dockerfile

FROM oven/bun:1.3-alpine

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache python3 make g++ curl

# Copy package files
COPY package.json bun.lock ./

# Install dependencies
RUN bun install --frozen-lockfile

# Copy source code
COPY src ./src
COPY tsconfig.json ./
COPY prisma ./prisma

# Generate Prisma Client
RUN bunx prisma generate

# Build TypeScript
RUN bun run build

# Create non-root user
RUN addgroup -S catalyst && adduser -S catalyst -G catalyst
USER catalyst

# Expose port
EXPOSE 3000

# Start backend
CMD ["bun", "run", "start"]

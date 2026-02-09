# Catalyst Backend - Dockerfile

FROM node:20-alpine

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache python3 make g++ curl

# Copy package files
COPY package.json package-lock.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY src ./src
COPY tsconfig.json ./
COPY prisma ./prisma

# Generate Prisma Client
RUN npx prisma generate

# Build TypeScript
RUN npm run build

# Create non-root user
RUN addgroup -S catalyst && adduser -S catalyst -G catalyst
USER catalyst

# Expose port
EXPOSE 3000

# Start backend
CMD ["npm", "start"]

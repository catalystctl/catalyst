import { PrismaClient } from "@prisma/client";
import { PrismaPg } from '@prisma/adapter-pg';

// Prisma v7: Use adapter for PostgreSQL
// Pass connection config directly to PrismaPg instead of a pre-built pg.Pool
// to avoid instanceof check failures in hoisted pnpm layouts
const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
  // Default 15: several worker processes share one Postgres instance —
  // (workers × pool size) must stay under Postgres max_connections=100.
  max: Number(process.env.DB_POOL_MAX || 15),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 30000,
  application_name: 'catalyst-api',
  // 30s statement_timeout, applied server-side on every new connection via the
  // pg PoolConfig `options` field (pg 8.x ClientConfig also has a dedicated
  // statement_timeout field that feeds the same startup-packet parameter).
  options: '-c statement_timeout=30000',
});

export const prisma = new PrismaClient({
  adapter,
  log: ["info", "warn", "error"],
});

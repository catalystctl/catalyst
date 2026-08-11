import { PrismaClient } from "@prisma/client";
import { PrismaPg } from '@prisma/adapter-pg';

// Prisma v7: Use adapter for PostgreSQL
// Pass connection config directly to PrismaPg instead of a pre-built pg.Pool
// to avoid instanceof check failures in hoisted pnpm layouts
const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.DB_POOL_MAX || 50),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 30000,
  application_name: 'catalyst-api',
  // statement_timeout should be set via PostgreSQL configuration or via SET statement_timeout
  // on each connection. pg.Pool does not natively support a connection-level statement_timeout
  // option; configure it in postgresql.conf or via a pool 'connect' listener if desired.
});

export const prisma = new PrismaClient({
  adapter,
  log: ["info", "warn", "error"],
});

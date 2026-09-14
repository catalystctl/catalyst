import type { DatabaseHost } from "@prisma/client";
import { DatabaseProvisioningError, getDatabaseHostConnectTimeoutMs } from "./database-errors.js";

interface PgClientLike {
  connect(): Promise<unknown>;
  end(): Promise<unknown>;
  query(text: string): Promise<unknown>;
}

type PgClientFactory = (config: Record<string, unknown>) => PgClientLike;

const loadPgClient = async (): Promise<PgClientFactory> => {
  const { Client } = await import("pg");
  return (config) => new Client(config) as PgClientLike;
};

export const isPostgresEngine = (engine: string | null | undefined) => {
  const normalized = (engine || "").toLowerCase();
  return normalized === "postgresql" || normalized === "postgres";
};

export const isPostgresHost = (host: Pick<DatabaseHost, "engine">) =>
  isPostgresEngine(host.engine);

const maintenanceDatabase = (host: DatabaseHost) => host.database?.trim() || "postgres";

// Identifiers reaching this layer are pre-validated upstream
// (isValidDatabaseIdentifier), but quoting stays mandatory: DROP DATABASE
// during server/bulk delete replays stored values.
const quoteIdent = (value: string) => `"${value.replace(/"/g, '""')}"`;
const quoteLiteral = (value: string) => `'${value.replace(/'/g, "''")}'`;

const connectionErrorCodes = new Set([
  "ECONNREFUSED",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EHOSTUNREACH",
  "ECONNRESET",
]);

const conflictErrorCodes = new Set([
  "42P04", // duplicate_database
  "42710", // duplicate_object (role already exists)
]);

const mapPostgresError = (
  error: unknown,
  fallbackMessage: string,
  conflictMessage = "Database name or username already exists on this host",
): DatabaseProvisioningError => {
  if (error instanceof DatabaseProvisioningError) {
    return error;
  }
  const code = (error as { code?: unknown })?.code;
  if (typeof code === "string") {
    if (connectionErrorCodes.has(code) || code === "28P01") {
      return new DatabaseProvisioningError("Database host is unavailable", 503);
    }
    if (code === "42501") {
      return new DatabaseProvisioningError(
        "Database host credentials lack required privileges",
        500,
      );
    }
    // 42704 (undefined_object) surfaces when ALTER ROLE targets a missing
    // role; callers pass a not-found message for rotate/drop.
    if (code === "42704" || conflictErrorCodes.has(code)) {
      return new DatabaseProvisioningError(conflictMessage, 409);
    }
  }
  return new DatabaseProvisioningError(fallbackMessage, 500);
};

const withPostgresConnection = async <T>(
  host: DatabaseHost,
  handler: (client: PgClientLike) => Promise<T>,
) => {
  const createClient = await loadPgClient();
  const client = createClient({
    host: host.host,
    port: host.port,
    user: host.username,
    password: host.password,
    database: maintenanceDatabase(host),
    connectionTimeoutMillis: getDatabaseHostConnectTimeoutMs(),
  });
  await client.connect();
  try {
    return await handler(client);
  } finally {
    await client.end().catch(() => undefined);
  }
};

const guardMaintenanceDatabase = (host: DatabaseHost, databaseName: string) => {
  if (databaseName === maintenanceDatabase(host)) {
    throw new DatabaseProvisioningError("Cannot manage the maintenance database", 409);
  }
};

export const provisionPostgresDatabase = async (
  host: DatabaseHost,
  databaseName: string,
  username: string,
  password: string,
) => {
  guardMaintenanceDatabase(host, databaseName);
  try {
    await withPostgresConnection(host, async (client) => {
      let roleCreated = false;
      let databaseCreated = false;
      try {
        await client.query(
          `CREATE ROLE ${quoteIdent(username)} WITH LOGIN PASSWORD ${quoteLiteral(password)}`,
        );
        roleCreated = true;
        await client.query(
          `CREATE DATABASE ${quoteIdent(databaseName)} OWNER ${quoteIdent(username)} ENCODING 'UTF8'`,
        );
        databaseCreated = true;
      } catch (error) {
        if (databaseCreated) {
          try {
            await client.query(`DROP DATABASE IF EXISTS ${quoteIdent(databaseName)}`);
          } catch {
            // ignore cleanup errors
          }
        }
        if (roleCreated) {
          try {
            await client.query(`DROP ROLE IF EXISTS ${quoteIdent(username)}`);
          } catch {
            // ignore cleanup errors
          }
        }
        throw error;
      }
    });
  } catch (error) {
    throw mapPostgresError(error, "Database provisioning failed");
  }
};

export const rotatePostgresPassword = async (
  host: DatabaseHost,
  username: string,
  password: string,
) => {
  try {
    await withPostgresConnection(host, async (client) => {
      await client.query(
        `ALTER ROLE ${quoteIdent(username)} WITH PASSWORD ${quoteLiteral(password)}`,
      );
    });
  } catch (error) {
    throw mapPostgresError(error, "Database password rotation failed", "Database user not found on host");
  }
};

export const dropPostgresDatabase = async (
  host: DatabaseHost,
  databaseName: string,
  username: string,
) => {
  guardMaintenanceDatabase(host, databaseName);
  try {
    await withPostgresConnection(host, async (client) => {
      await client.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = ${quoteLiteral(databaseName)} AND pid <> pg_backend_pid()`,
      );
      await client.query(`DROP DATABASE IF EXISTS ${quoteIdent(databaseName)}`);
      await client.query(`DROP ROLE IF EXISTS ${quoteIdent(username)}`);
    });
  } catch (error) {
    throw mapPostgresError(error, "Database deletion failed", "Database user not found on host");
  }
};

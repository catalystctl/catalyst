import mysql from "mysql2/promise";
import type { DatabaseHost } from "@prisma/client";

export class DatabaseProvisioningError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 500) {
    super(message);
    this.statusCode = statusCode;
  }
}

const connectionErrorCodes = new Set([
  "ECONNREFUSED",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EHOSTUNREACH",
  "ECONNRESET",
]);

const conflictErrorCodes = new Set([
  "ER_DB_CREATE_EXISTS",
  "ER_USER_ALREADY_EXISTS",
  "ER_CANNOT_USER",
]);

const privilegeErrorCodes = new Set([
  "ER_SPECIFIC_ACCESS_DENIED_ERROR",
  "ER_TABLEACCESS_DENIED_ERROR",
  "ER_DBACCESS_DENIED_ERROR",
]);

const authPluginErrorCodes = new Set([
  "ER_PLUGIN_IS_NOT_LOADED",
  "ER_PLUGIN_NOT_LOADED",
  "ER_INVALID_PLUGIN",
  "ER_NOT_SUPPORTED_AUTH_MODE",
]);

const getConnectTimeoutMs = () => {
  const raw = Number(process.env.DATABASE_HOST_CONNECT_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 5000;
};

const mapProvisioningError = (
  error: any,
  fallbackMessage: string,
  conflictMessage = "Database name or username already exists on this host",
) => {
  if (error instanceof DatabaseProvisioningError) {
    return error;
  }

  const code = error?.code;
  if (connectionErrorCodes.has(code) || code === "ER_ACCESS_DENIED_ERROR") {
    return new DatabaseProvisioningError("Database host is unavailable", 503);
  }

  if (privilegeErrorCodes.has(code)) {
    return new DatabaseProvisioningError(
      "Database host credentials lack required privileges",
      500,
    );
  }

  if (conflictErrorCodes.has(code)) {
    return new DatabaseProvisioningError(conflictMessage, 409);
  }

  return new DatabaseProvisioningError(fallbackMessage, 500);
};

const withDatabaseConnection = async <T>(
  host: DatabaseHost,
  handler: (connection: mysql.Connection) => Promise<T>,
) => {
  const connection = await mysql.createConnection({
    host: host.host,
    port: host.port,
    user: host.username,
    password: host.password,
    connectTimeout: getConnectTimeoutMs(),
    multipleStatements: false,
  });

  try {
    return await handler(connection);
  } finally {
    await connection.end().catch(() => undefined);
  }
};

export const provisionDatabase = async (
  host: DatabaseHost,
  databaseName: string,
  username: string,
  password: string,
) => {
  try {
    await withDatabaseConnection(host, async (connection) => {
      // sphinx:ignore sql-injection - identifiers/values escaped via mysql.escapeId/mysql.escape (no placeholders for DDL)
      const databaseId = mysql.escapeId(databaseName);
      const escapedUser = mysql.escape(username);
      const escapedPassword = mysql.escape(password);
      let databaseCreated = false;
      let userCreated = false;

      try {
        await connection.execute(`CREATE DATABASE ${databaseId}`);
        databaseCreated = true;
        const createUser = async (useNative: boolean) => {
          const clause = useNative
            ? `CREATE USER ${escapedUser}@'%' IDENTIFIED WITH mysql_native_password BY ${escapedPassword}`
            : `CREATE USER ${escapedUser}@'%' IDENTIFIED BY ${escapedPassword}`;
          await connection.execute(clause);
        };
        try {
          await createUser(true);
        } catch (error: any) {
          if (!authPluginErrorCodes.has(error?.code)) {
            throw error;
          }
          await createUser(false);
        }
        userCreated = true;
        await connection.execute(`GRANT ALL PRIVILEGES ON ${databaseId}.* TO ${escapedUser}@'%'`);
        await connection.execute("FLUSH PRIVILEGES");
      } catch (error) {
        if (userCreated) {
          try {
            await connection.execute(`DROP USER IF EXISTS ${escapedUser}@'%'`);
          } catch {
            // ignore cleanup errors
          }
        }
        if (databaseCreated) {
          try {
            await connection.execute(`DROP DATABASE IF EXISTS ${databaseId}`);
          } catch {
            // ignore cleanup errors
          }
        }
        throw error;
      }
    });
  } catch (error: any) {
    throw mapProvisioningError(error, "Database provisioning failed");
  }
};

export const rotateDatabasePassword = async (
  host: DatabaseHost,
  username: string,
  password: string,
) => {
  try {
    await withDatabaseConnection(host, async (connection) => {
      const escapedUser = mysql.escape(username);
      const escapedPassword = mysql.escape(password);
      const alterUser = async (useNative: boolean) => {
        const clause = useNative
          ? `ALTER USER ${escapedUser}@'%' IDENTIFIED WITH mysql_native_password BY ${escapedPassword}`
          : `ALTER USER ${escapedUser}@'%' IDENTIFIED BY ${escapedPassword}`;
        await connection.execute(clause);
      };
      try {
        await alterUser(true);
      } catch (error: any) {
        if (!authPluginErrorCodes.has(error?.code)) {
          throw error;
        }
        await alterUser(false);
      }
      await connection.execute("FLUSH PRIVILEGES");
    });
  } catch (error: any) {
    throw mapProvisioningError(error, "Database password rotation failed", "Database user not found on host");
  }
};

export const dropDatabase = async (
  host: DatabaseHost,
  databaseName: string,
  username: string,
) => {
  try {
    await withDatabaseConnection(host, async (connection) => {
      // sphinx:ignore sql-injection - escaped via mysql.escapeId/mysql.escape, DDL cannot use ? placeholders
      const databaseId = mysql.escapeId(databaseName);
      const escapedUser = mysql.escape(username);
      await connection.execute(`DROP DATABASE IF EXISTS ${databaseId}`);
      await connection.execute(`DROP USER IF EXISTS ${escapedUser}@'%'`);
      await connection.execute("FLUSH PRIVILEGES");
    });
  } catch (error: any) {
    throw mapProvisioningError(error, "Database deletion failed", "Database user not found on host");
  }
};

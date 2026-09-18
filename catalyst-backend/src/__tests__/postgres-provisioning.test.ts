/**
 * Native Postgres support for server databases (provision/rotate/drop).
 *
 * The panel accepts `postgresql` database hosts; these tests pin the SQL
 * emitted against a mocked `pg` driver plus the engine dispatch in
 * services/mysql.ts, so no live database is needed.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { DatabaseHost } from "@prisma/client";

vi.mock("pg", () => {
  const queries: string[] = [];
  let impl: ((text: string) => Promise<unknown>) | null = null;
  class Client {
    static queries = queries;
    static instances = 0;
    static config: Record<string, unknown> | null = null;
    static setImpl(next: ((text: string) => Promise<unknown>) | null) {
      impl = next;
    }
    ended = 0;
    constructor(config: Record<string, unknown>) {
      Client.instances += 1;
      Client.config = config;
    }
    async connect() {}
    async end() {
      this.ended += 1;
    }
    async query(text: string) {
      queries.push(text);
      if (impl) return impl(text);
      return { rows: [] };
    }
  }
  return { Client };
});

const mysqlExecute = vi.fn(async () => []);
const mysqlConnect = vi.fn(async () => ({
  execute: mysqlExecute,
  end: vi.fn(async () => {}),
}));

vi.mock("mysql2/promise", () => ({
  default: {
    createConnection: mysqlConnect,
    escapeId: (value: string) => `\`${value}\``,
    escape: (value: string) => `'${value}'`,
  },
}));

const pgHost = (overrides: Partial<DatabaseHost> = {}): DatabaseHost =>
  ({
    id: "host1",
    name: "Game Postgres",
    host: "catalyst-game-postgres",
    port: 5432,
    username: "gameadmin",
    password: "secret",
    engine: "postgresql",
    database: "game_dbs",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }) as DatabaseHost;

const mysqlHost = (): DatabaseHost => pgHost({ engine: "mysql", database: "catalyst_dbs" });

const pgClient = async () => {
  const { Client } = await import("pg");
  return Client as unknown as {
    queries: string[];
    instances: number;
    config: Record<string, unknown> | null;
    setImpl(next: ((text: string) => Promise<unknown>) | null): void;
  };
};

const pgError = (code: string) => {
  const error = new Error(`pg failed: ${code}`) as Error & { code: string };
  error.code = code;
  return error;
};

beforeEach(async () => {
  // The suite runs with isolate:false (one shared module registry). When an
  // earlier file (e.g. authz-fixes via routes/servers/_helpers) imports
  // services/mysql.js first, it caches the REAL mysql2 binding and this
  // file's vi.mock can no longer reach it — intermittently, depending on
  // import timing. Reset the registry so the per-test dynamic imports below
  // re-evaluate services/mysql.js against the mocks declared here.
  vi.resetModules();
  const Client = await pgClient();
  Client.queries.length = 0;
  Client.instances = 0;
  Client.config = null;
  Client.setImpl(null);
  mysqlConnect.mockClear();
  mysqlExecute.mockClear();
});

describe("provisionPostgresDatabase", () => {
  it("creates the role then an owner database and closes the connection", async () => {
    const { provisionPostgresDatabase } = await import("../services/postgres.js");
    const Client = await pgClient();

    await provisionPostgresDatabase(pgHost(), "srv_ab12cd34", "srv_ab12cd_u1", "psecret123");

    expect(Client.instances).toBe(1);
    expect(Client.config).toMatchObject({
      host: "catalyst-game-postgres",
      port: 5432,
      user: "gameadmin",
      database: "game_dbs",
    });
    expect(Client.queries).toEqual([
      `CREATE ROLE "srv_ab12cd_u1" WITH LOGIN PASSWORD 'psecret123'`,
      `CREATE DATABASE "srv_ab12cd34" OWNER "srv_ab12cd_u1" ENCODING 'UTF8'`,
    ]);
  });

  it("drops the created role when database creation fails", async () => {
    const { provisionPostgresDatabase } = await import("../services/postgres.js");
    const { DatabaseProvisioningError } = await import("../services/database-errors.js");
    const Client = await pgClient();
    Client.setImpl(async (text) => {
      if (text.startsWith("CREATE DATABASE")) throw pgError("XX000");
      return { rows: [] };
    });

    await expect(
      provisionPostgresDatabase(pgHost(), "srv_ab12cd34", "srv_ab12cd_u1", "psecret123"),
    ).rejects.toBeInstanceOf(DatabaseProvisioningError);
    expect(Client.queries).toContain(`DROP ROLE IF EXISTS "srv_ab12cd_u1"`);
  });

  it("maps duplicate database to 409 and refused connections to 503", async () => {
    const { provisionPostgresDatabase } = await import("../services/postgres.js");
    const Client = await pgClient();

    Client.setImpl(async () => {
      throw pgError("42P04");
    });
    let duplicate: { statusCode?: number; message?: string } = {};
    try {
      await provisionPostgresDatabase(pgHost(), "srv_ab12cd34", "srv_ab12cd_u1", "psecret123");
    } catch (error) {
      duplicate = error as { statusCode?: number; message?: string };
    }
    expect(duplicate.statusCode).toBe(409);

    Client.setImpl(async () => {
      throw pgError("ECONNREFUSED");
    });
    let unavailable: { statusCode?: number; message?: string } = {};
    try {
      await provisionPostgresDatabase(pgHost(), "srv_ab12cd34", "srv_ab12cd_u1", "psecret123");
    } catch (error) {
      unavailable = error as { statusCode?: number; message?: string };
    }
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.message).toBe("Database host is unavailable");
  });

  it("maps insufficient privilege to 500", async () => {
    const { provisionPostgresDatabase } = await import("../services/postgres.js");
    const Client = await pgClient();
    Client.setImpl(async () => {
      throw pgError("42501");
    });

    const error = await provisionPostgresDatabase(
      pgHost(),
      "srv_ab12cd34",
      "srv_ab12cd_u1",
      "psecret123",
    ).then(
      (): { statusCode?: number; message?: string } => ({}),
      (failure: unknown) => failure as { statusCode?: number; message?: string },
    );
    expect(error.statusCode).toBe(500);
    expect(error.message).toBe("Database host credentials lack required privileges");
  });

  it("refuses to manage the maintenance database without connecting", async () => {
    const { provisionPostgresDatabase } = await import("../services/postgres.js");
    const Client = await pgClient();

    const error = await provisionPostgresDatabase(pgHost(), "game_dbs", "srv_ab12cd_u1", "psecret123").then(
      (): { statusCode?: number } => ({}),
      (failure: unknown) => failure as { statusCode?: number },
    );
    expect(error.statusCode).toBe(409);
    expect(Client.instances).toBe(0);
  });

  it("escapes quotes in identifiers and passwords", async () => {
    const { provisionPostgresDatabase } = await import("../services/postgres.js");
    const Client = await pgClient();

    await provisionPostgresDatabase(pgHost(), 'srv_a"b', 'srv_u"x', "p'a");
    expect(Client.queries[0]).toBe(
      `CREATE ROLE "srv_u""x" WITH LOGIN PASSWORD 'p''a'`,
    );
    expect(Client.queries[1]).toBe(
      `CREATE DATABASE "srv_a""b" OWNER "srv_u""x" ENCODING 'UTF8'`,
    );
  });
});

describe("rotate/drop postgres", () => {
  it("alters the role password and maps a missing role to 409", async () => {
    const { rotatePostgresPassword } = await import("../services/postgres.js");
    const Client = await pgClient();

    await rotatePostgresPassword(pgHost(), "srv_ab12cd_u1", "pnewsecret123456");
    expect(Client.queries).toEqual([
      `ALTER ROLE "srv_ab12cd_u1" WITH PASSWORD 'pnewsecret123456'`,
    ]);

    Client.setImpl(async () => {
      throw pgError("42704");
    });
    const error = await rotatePostgresPassword(pgHost(), "srv_nope", "pnewsecret123456").then(
      (): { statusCode?: number; message?: string } => ({}),
      (failure: unknown) => failure as { statusCode?: number; message?: string },
    );
    expect(error.statusCode).toBe(409);
    expect(error.message).toBe("Database user not found on host");
  });

  it("terminates backends before dropping the database and role", async () => {
    const { dropPostgresDatabase } = await import("../services/postgres.js");
    const Client = await pgClient();

    await dropPostgresDatabase(pgHost(), "srv_ab12cd34", "srv_ab12cd_u1");
    expect(Client.queries).toEqual([
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'srv_ab12cd34' AND pid <> pg_backend_pid()`,
      `DROP DATABASE IF EXISTS "srv_ab12cd34"`,
      `DROP ROLE IF EXISTS "srv_ab12cd_u1"`,
    ]);
  });
});

describe("engine dispatch in services/mysql.ts", () => {
  it("routes postgres hosts to pg and never touches mysql2", async () => {
    const { provisionDatabase } = await import("../services/mysql.js");
    const Client = await pgClient();

    await provisionDatabase(pgHost(), "srv_ab12cd34", "srv_ab12cd_u1", "psecret123");
    expect(Client.instances).toBe(1);
    expect(mysqlConnect).not.toHaveBeenCalled();
  });

  it("keeps mysql hosts on the mysql2 path", async () => {
    const { provisionDatabase, dropDatabase } = await import("../services/mysql.js");
    const Client = await pgClient();

    await provisionDatabase(mysqlHost(), "srv_ab12cd34", "srv_ab12cd_u1", "psecret123");
    expect(mysqlConnect).toHaveBeenCalled();
    expect(Client.instances).toBe(0);

    await dropDatabase(mysqlHost(), "srv_ab12cd34", "srv_ab12cd_u1");
    expect(Client.instances).toBe(0);
  });
});

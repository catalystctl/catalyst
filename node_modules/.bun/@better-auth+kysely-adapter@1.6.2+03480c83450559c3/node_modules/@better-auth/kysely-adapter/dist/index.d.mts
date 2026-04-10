import { Kysely } from "kysely";
import { DBAdapter, DBAdapterDebugLogOption } from "@better-auth/core/db/adapter";
import { BetterAuthOptions } from "@better-auth/core";

//#region src/types.d.ts
type KyselyDatabaseType = "postgres" | "mysql" | "sqlite" | "mssql";
//#endregion
//#region src/dialect.d.ts
declare function getKyselyDatabaseType(db: BetterAuthOptions["database"]): KyselyDatabaseType | null;
declare const createKyselyAdapter: (config: BetterAuthOptions) => Promise<{
  kysely: Kysely<any>;
  databaseType: "postgres" | "mysql" | "sqlite" | "mssql";
  transaction: boolean | undefined;
} | {
  kysely: Kysely<any> | null;
  databaseType: KyselyDatabaseType | null;
  transaction: undefined;
}>;
//#endregion
//#region src/kysely-adapter.d.ts
interface KyselyAdapterConfig {
  /**
   * Database type.
   */
  type?: KyselyDatabaseType | undefined;
  /**
   * Enable debug logs for the adapter
   *
   * @default false
   */
  debugLogs?: DBAdapterDebugLogOption | undefined;
  /**
   * Use plural for table names.
   *
   * @default false
   */
  usePlural?: boolean | undefined;
  /**
   * Whether to execute multiple operations in a transaction.
   *
   * If the database doesn't support transactions,
   * set this to `false` and operations will be executed sequentially.
   * @default false
   */
  transaction?: boolean | undefined;
}
declare const kyselyAdapter: (db: Kysely<any>, config?: KyselyAdapterConfig | undefined) => (options: BetterAuthOptions) => DBAdapter<BetterAuthOptions>;
//#endregion
export { KyselyDatabaseType, createKyselyAdapter, getKyselyDatabaseType, kyselyAdapter };
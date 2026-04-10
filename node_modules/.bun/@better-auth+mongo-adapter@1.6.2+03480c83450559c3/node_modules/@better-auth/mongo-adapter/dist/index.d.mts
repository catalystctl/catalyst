import { DBAdapter, DBAdapterDebugLogOption } from "@better-auth/core/db/adapter";
import { Db, MongoClient } from "mongodb";
import { BetterAuthOptions } from "@better-auth/core";

//#region src/mongodb-adapter.d.ts
interface MongoDBAdapterConfig {
  /**
   * MongoDB client instance
   * If not provided, Database transactions won't be enabled.
   */
  client?: MongoClient | undefined;
  /**
   * Enable debug logs for the adapter
   *
   * @default false
   */
  debugLogs?: DBAdapterDebugLogOption | undefined;
  /**
   * Use plural table names
   *
   * @default false
   */
  usePlural?: boolean | undefined;
  /**
   * Whether to execute multiple operations in a transaction.
   *
   * ⚠️ Important:
   * - Defaults to `true` when a MongoDB client is provided.
   * - If your MongoDB instance does not support transactions
   *   (e.g. standalone server without a replica set),
   *   you must explicitly set `transaction: false`.
   */
  transaction?: boolean | undefined;
}
declare const mongodbAdapter: (db: Db, config?: MongoDBAdapterConfig | undefined) => (options: BetterAuthOptions) => DBAdapter<BetterAuthOptions>;
//#endregion
export { MongoDBAdapterConfig, mongodbAdapter };
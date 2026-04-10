import * as _better_auth_core_db_adapter0 from "@better-auth/core/db/adapter";
import { DBAdapterDebugLogOption } from "@better-auth/core/db/adapter";
import { BetterAuthOptions } from "@better-auth/core";

//#region src/memory-adapter.d.ts
interface MemoryDB {
  [key: string]: any[];
}
interface MemoryAdapterConfig {
  debugLogs?: DBAdapterDebugLogOption | undefined;
}
declare const memoryAdapter: (db: MemoryDB, config?: MemoryAdapterConfig | undefined) => (options: BetterAuthOptions) => _better_auth_core_db_adapter0.DBAdapter<BetterAuthOptions>;
//#endregion
export { type MemoryAdapterConfig, type MemoryDB, memoryAdapter };
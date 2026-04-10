import { BetterAuthDBSchema } from "./type.mjs";
import { BetterAuthOptions } from "../types/init-options.mjs";
//#region src/db/get-tables.d.ts
declare const getAuthTables: (options: BetterAuthOptions) => BetterAuthDBSchema;
//#endregion
export { getAuthTables };
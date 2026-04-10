import { DBFieldAttribute } from "./type.mjs";

//#region src/db/plugin.d.ts
type BetterAuthPluginDBSchema = { [table in string]: {
  fields: {
    [field: string]: DBFieldAttribute;
  };
  disableMigration?: boolean | undefined;
  modelName?: string | undefined;
} };
//#endregion
export { BetterAuthPluginDBSchema };
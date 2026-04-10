import { BetterAuthOptions } from "@better-auth/core";
import { BaseModelNames } from "@better-auth/core/db";
import { DBAdapter, Where } from "@better-auth/core/db/adapter";

//#region src/db/with-hooks.d.ts
type DatabaseHooksEntry = {
  source: string;
  hooks: Exclude<BetterAuthOptions["databaseHooks"], undefined>;
};
declare function getWithHooks(adapter: DBAdapter<BetterAuthOptions>, ctx: {
  options: BetterAuthOptions;
  hooks: DatabaseHooksEntry[];
}): {
  createWithHooks: <T extends Record<string, any>>(data: T, model: BaseModelNames, customCreateFn?: {
    fn: (data: Record<string, any>) => void | Promise<any>;
    executeMainFn?: boolean;
  } | undefined) => Promise<any>;
  updateWithHooks: <T extends Record<string, any>>(data: any, where: Where[], model: BaseModelNames, customUpdateFn?: {
    fn: (data: Record<string, any>) => void | Promise<any>;
    executeMainFn?: boolean;
  } | undefined) => Promise<any>;
  updateManyWithHooks: <_T extends Record<string, any>>(data: any, where: Where[], model: BaseModelNames, customUpdateFn?: {
    fn: (data: Record<string, any>) => void | Promise<any>;
    executeMainFn?: boolean;
  } | undefined) => Promise<any>;
  deleteWithHooks: <T extends Record<string, any>>(where: Where[], model: BaseModelNames, customDeleteFn?: {
    fn: (where: Where[]) => void | Promise<any>;
    executeMainFn?: boolean;
  } | undefined) => Promise<any>;
  deleteManyWithHooks: <T extends Record<string, any>>(where: Where[], model: BaseModelNames, customDeleteFn?: {
    fn: (where: Where[]) => void | Promise<any>;
    executeMainFn?: boolean;
  } | undefined) => Promise<any>;
};
//#endregion
export { DatabaseHooksEntry, getWithHooks };
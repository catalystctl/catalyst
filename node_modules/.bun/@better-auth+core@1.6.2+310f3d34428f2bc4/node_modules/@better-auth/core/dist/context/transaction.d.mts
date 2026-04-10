import { DBAdapter, DBTransactionAdapter } from "../db/adapter/index.mjs";
import { AsyncLocalStorage } from "node:async_hooks";

//#region src/context/transaction.d.ts
type HookContext = {
  adapter: DBTransactionAdapter;
  pendingHooks: Array<() => Promise<void>>;
};
/**
 * This is for internal use only. Most users should use `getCurrentAdapter` instead.
 *
 * It is exposed for advanced use cases where you need direct access to the AsyncLocalStorage instance.
 */
declare const getCurrentDBAdapterAsyncLocalStorage: () => Promise<AsyncLocalStorage<HookContext>>;
declare const getCurrentAdapter: (fallback: DBTransactionAdapter) => Promise<DBTransactionAdapter>;
declare const runWithAdapter: <R>(adapter: DBAdapter, fn: () => R) => Promise<R>;
declare const runWithTransaction: <R>(adapter: DBAdapter, fn: () => R) => Promise<R>;
/**
 * Queue a hook to be executed after the current transaction commits.
 * If not in a transaction, the hook will execute immediately.
 */
declare const queueAfterTransactionHook: (hook: () => Promise<void>) => Promise<void>;
//#endregion
export { getCurrentAdapter, getCurrentDBAdapterAsyncLocalStorage, queueAfterTransactionHook, runWithAdapter, runWithTransaction };
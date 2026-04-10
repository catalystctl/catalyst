import { AuthContext } from "../types/context.mjs";
import { EndpointContext, InputContext } from "better-call";
import { AsyncLocalStorage } from "@better-auth/core/async_hooks";

//#region src/context/endpoint-context.d.ts
type AuthEndpointContext = Partial<InputContext<string, any> & EndpointContext<string, any>> & {
  context: AuthContext;
};
/**
 * This is for internal use only. Most users should use `getCurrentAuthContext` instead.
 *
 * It is exposed for advanced use cases where you need direct access to the AsyncLocalStorage instance.
 */
declare function getCurrentAuthContextAsyncLocalStorage(): Promise<AsyncLocalStorage<AuthEndpointContext>>;
declare function getCurrentAuthContext(): Promise<AuthEndpointContext>;
declare function runWithEndpointContext<T>(context: AuthEndpointContext, fn: () => T): Promise<T>;
//#endregion
export { AuthEndpointContext, getCurrentAuthContext, getCurrentAuthContextAsyncLocalStorage, runWithEndpointContext };
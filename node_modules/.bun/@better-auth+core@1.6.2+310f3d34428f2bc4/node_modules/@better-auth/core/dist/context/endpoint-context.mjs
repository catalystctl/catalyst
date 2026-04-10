import { __getBetterAuthGlobal } from "./global.mjs";
import { getAsyncLocalStorage } from "@better-auth/core/async_hooks";
//#region src/context/endpoint-context.ts
const ensureAsyncStorage = async () => {
	const betterAuthGlobal = __getBetterAuthGlobal();
	if (!betterAuthGlobal.context.endpointContextAsyncStorage) {
		const AsyncLocalStorage = await getAsyncLocalStorage();
		betterAuthGlobal.context.endpointContextAsyncStorage = new AsyncLocalStorage();
	}
	return betterAuthGlobal.context.endpointContextAsyncStorage;
};
/**
* This is for internal use only. Most users should use `getCurrentAuthContext` instead.
*
* It is exposed for advanced use cases where you need direct access to the AsyncLocalStorage instance.
*/
async function getCurrentAuthContextAsyncLocalStorage() {
	return ensureAsyncStorage();
}
async function getCurrentAuthContext() {
	const context = (await ensureAsyncStorage()).getStore();
	if (!context) throw new Error("No auth context found. Please make sure you are calling this function within a `runWithEndpointContext` callback.");
	return context;
}
async function runWithEndpointContext(context, fn) {
	return (await ensureAsyncStorage()).run(context, fn);
}
//#endregion
export { getCurrentAuthContext, getCurrentAuthContextAsyncLocalStorage, runWithEndpointContext };

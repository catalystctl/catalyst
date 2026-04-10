import { __getBetterAuthGlobal } from "./global.mjs";
import { getAsyncLocalStorage } from "@better-auth/core/async_hooks";
//#region src/context/request-state.ts
const ensureAsyncStorage = async () => {
	const betterAuthGlobal = __getBetterAuthGlobal();
	if (!betterAuthGlobal.context.requestStateAsyncStorage) {
		const AsyncLocalStorage = await getAsyncLocalStorage();
		betterAuthGlobal.context.requestStateAsyncStorage = new AsyncLocalStorage();
	}
	return betterAuthGlobal.context.requestStateAsyncStorage;
};
async function getRequestStateAsyncLocalStorage() {
	return ensureAsyncStorage();
}
async function hasRequestState() {
	return (await ensureAsyncStorage()).getStore() !== void 0;
}
async function getCurrentRequestState() {
	const store = (await ensureAsyncStorage()).getStore();
	if (!store) throw new Error("No request state found. Please make sure you are calling this function within a `runWithRequestState` callback.");
	return store;
}
async function runWithRequestState(store, fn) {
	return (await ensureAsyncStorage()).run(store, fn);
}
function defineRequestState(initFn) {
	const ref = Object.freeze({});
	return {
		get ref() {
			return ref;
		},
		async get() {
			const store = await getCurrentRequestState();
			if (!store.has(ref)) {
				const initialValue = await initFn();
				store.set(ref, initialValue);
				return initialValue;
			}
			return store.get(ref);
		},
		async set(value) {
			(await getCurrentRequestState()).set(ref, value);
		}
	};
}
//#endregion
export { defineRequestState, getCurrentRequestState, getRequestStateAsyncLocalStorage, hasRequestState, runWithRequestState };

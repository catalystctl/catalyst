import { AsyncLocalStorage } from "@better-auth/core/async_hooks";

//#region src/context/request-state.d.ts
type RequestStateWeakMap = WeakMap<object, any>;
declare function getRequestStateAsyncLocalStorage(): Promise<AsyncLocalStorage<RequestStateWeakMap>>;
declare function hasRequestState(): Promise<boolean>;
declare function getCurrentRequestState(): Promise<RequestStateWeakMap>;
declare function runWithRequestState<T>(store: RequestStateWeakMap, fn: () => T): Promise<T>;
interface RequestState<T> {
  get(): Promise<T>;
  set(value: T): Promise<void>;
  readonly ref: Readonly<object>;
}
/**
 * Defines a request-scoped state with lazy initialization.
 *
 * @param initFn - A function that initializes the state. It is called the first time `get()` is invoked within each request context, and only once per context.
 * @returns A RequestState object with `get` and `set` methods, and a unique `ref` for debugging.
 *
 * @example
 * const userState = defineRequestState(() => ({ id: '', name: '' }));
 * // Later, within a request context:
 * const user = await userState.get();
 */
declare function defineRequestState<T>(initFn: () => T | Promise<T>): RequestState<T>;
//#endregion
export { RequestState, RequestStateWeakMap, defineRequestState, getCurrentRequestState, getRequestStateAsyncLocalStorage, hasRequestState, runWithRequestState };
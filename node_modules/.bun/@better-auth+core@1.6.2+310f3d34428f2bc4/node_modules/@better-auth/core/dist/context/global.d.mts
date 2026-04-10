import { AsyncLocalStorage } from "@better-auth/core/async_hooks";

//#region src/context/global.d.ts
declare function getBetterAuthVersion(): string;
//#endregion
export { getBetterAuthVersion };
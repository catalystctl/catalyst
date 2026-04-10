import { defineRequestState } from "@better-auth/core/context";
//#region src/api/state/oauth.ts
const { get: getOAuthState, set: setOAuthState } = defineRequestState(() => null);
//#endregion
export { getOAuthState, setOAuthState };

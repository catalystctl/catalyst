import { APIError } from "@better-auth/core/error";

//#region src/utils/is-api-error.d.ts
declare function isAPIError(error: unknown): error is APIError;
//#endregion
export { isAPIError };
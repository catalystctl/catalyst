import { APIErrorCode, BASE_ERROR_CODES } from "./codes.mjs";
import { APIError as APIError$1 } from "better-call/error";

//#region src/error/index.d.ts
declare class BetterAuthError extends Error {
  constructor(message: string, options?: {
    cause?: unknown | undefined;
  });
}
declare class APIError extends APIError$1 {
  constructor(...args: ConstructorParameters<typeof APIError$1>);
  static fromStatus(status: ConstructorParameters<typeof APIError$1>[0], body?: ConstructorParameters<typeof APIError$1>[1]): APIError;
  static from(status: ConstructorParameters<typeof APIError$1>[0], error: {
    code: string;
    message: string;
  }): APIError;
}
//#endregion
export { APIError, type APIErrorCode, BASE_ERROR_CODES, BetterAuthError };
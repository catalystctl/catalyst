import { APIError } from "@better-auth/core/error";
import { APIError as APIError$1 } from "better-call";
//#region src/utils/is-api-error.ts
function isAPIError(error) {
	return error instanceof APIError$1 || error instanceof APIError || error?.name === "APIError";
}
//#endregion
export { isAPIError };

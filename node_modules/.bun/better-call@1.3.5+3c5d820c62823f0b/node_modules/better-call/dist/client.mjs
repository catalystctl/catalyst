import { APIError, BetterCallError, ValidationError, hideInternalStackFrames, kAPIErrorHeaderSymbol, makeErrorForHideStackFrame, statusCodes } from "./error.mjs";
import { createFetch } from "@better-fetch/fetch";

//#region src/client.ts
const createClient = (options) => {
	const fetch = createFetch(options ?? {});
	return async (path, ...options) => {
		return await fetch(path, { ...options[0] });
	};
};

//#endregion
export { APIError, BetterCallError, ValidationError, createClient, hideInternalStackFrames, kAPIErrorHeaderSymbol, makeErrorForHideStackFrame, statusCodes };
//# sourceMappingURL=client.mjs.map
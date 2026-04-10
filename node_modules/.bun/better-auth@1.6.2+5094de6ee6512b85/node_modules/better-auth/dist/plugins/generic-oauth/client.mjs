import { PACKAGE_VERSION } from "../../version.mjs";
import { GENERIC_OAUTH_ERROR_CODES } from "./error-codes.mjs";
//#region src/plugins/generic-oauth/client.ts
const genericOAuthClient = () => {
	return {
		id: "generic-oauth-client",
		version: PACKAGE_VERSION,
		$InferServerPlugin: {},
		$ERROR_CODES: GENERIC_OAUTH_ERROR_CODES
	};
};
//#endregion
export { genericOAuthClient };

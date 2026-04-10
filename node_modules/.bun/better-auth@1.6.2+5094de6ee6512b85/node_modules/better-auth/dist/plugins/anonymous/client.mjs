import { PACKAGE_VERSION } from "../../version.mjs";
import { ANONYMOUS_ERROR_CODES } from "./error-codes.mjs";
//#region src/plugins/anonymous/client.ts
const anonymousClient = () => {
	return {
		id: "anonymous",
		version: PACKAGE_VERSION,
		$InferServerPlugin: {},
		pathMethods: {
			"/sign-in/anonymous": "POST",
			"/delete-anonymous-user": "POST"
		},
		atomListeners: [{
			matcher: (path) => path === "/sign-in/anonymous",
			signal: "$sessionSignal"
		}],
		$ERROR_CODES: ANONYMOUS_ERROR_CODES
	};
};
//#endregion
export { anonymousClient };

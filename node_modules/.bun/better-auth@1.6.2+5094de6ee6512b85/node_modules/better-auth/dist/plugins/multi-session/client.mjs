import { PACKAGE_VERSION } from "../../version.mjs";
import { MULTI_SESSION_ERROR_CODES } from "./error-codes.mjs";
//#region src/plugins/multi-session/client.ts
const multiSessionClient = () => {
	return {
		id: "multi-session",
		version: PACKAGE_VERSION,
		$InferServerPlugin: {},
		atomListeners: [{
			matcher(path) {
				return path === "/multi-session/set-active";
			},
			signal: "$sessionSignal"
		}],
		$ERROR_CODES: MULTI_SESSION_ERROR_CODES
	};
};
//#endregion
export { multiSessionClient };

import { PACKAGE_VERSION } from "../../version.mjs";
//#region src/plugins/device-authorization/client.ts
const deviceAuthorizationClient = () => {
	return {
		id: "device-authorization",
		version: PACKAGE_VERSION,
		$InferServerPlugin: {},
		pathMethods: {
			"/device/code": "POST",
			"/device/token": "POST",
			"/device": "GET",
			"/device/approve": "POST",
			"/device/deny": "POST"
		}
	};
};
//#endregion
export { deviceAuthorizationClient };

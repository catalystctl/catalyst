import { PACKAGE_VERSION } from "../../version.mjs";
//#region src/plugins/one-time-token/client.ts
const oneTimeTokenClient = () => {
	return {
		id: "one-time-token",
		version: PACKAGE_VERSION,
		$InferServerPlugin: {}
	};
};
//#endregion
export { oneTimeTokenClient };

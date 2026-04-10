import { PACKAGE_VERSION } from "../../version.mjs";
//#region src/plugins/magic-link/client.ts
const magicLinkClient = () => {
	return {
		id: "magic-link",
		version: PACKAGE_VERSION,
		$InferServerPlugin: {}
	};
};
//#endregion
export { magicLinkClient };

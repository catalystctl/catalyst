import { PACKAGE_VERSION } from "../../version.mjs";
//#region src/client/plugins/infer-plugin.ts
const InferServerPlugin = () => {
	return {
		id: "infer-server-plugin",
		version: PACKAGE_VERSION,
		$InferServerPlugin: {}
	};
};
//#endregion
export { InferServerPlugin };

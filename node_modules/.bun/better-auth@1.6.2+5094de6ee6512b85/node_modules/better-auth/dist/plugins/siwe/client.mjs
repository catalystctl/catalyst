import { PACKAGE_VERSION } from "../../version.mjs";
//#region src/plugins/siwe/client.ts
const siweClient = () => {
	return {
		id: "siwe",
		version: PACKAGE_VERSION,
		$InferServerPlugin: {}
	};
};
//#endregion
export { siweClient };

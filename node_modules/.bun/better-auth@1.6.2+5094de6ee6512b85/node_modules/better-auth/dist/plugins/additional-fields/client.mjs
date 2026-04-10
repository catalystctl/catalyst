import { PACKAGE_VERSION } from "../../version.mjs";
//#region src/plugins/additional-fields/client.ts
const inferAdditionalFields = (schema) => {
	return {
		id: "additional-fields-client",
		version: PACKAGE_VERSION,
		$InferServerPlugin: {}
	};
};
//#endregion
export { inferAdditionalFields };

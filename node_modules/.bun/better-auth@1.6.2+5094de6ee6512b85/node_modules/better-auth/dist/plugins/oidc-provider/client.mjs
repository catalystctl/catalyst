import { PACKAGE_VERSION } from "../../version.mjs";
//#region src/plugins/oidc-provider/client.ts
/**
* @deprecated Use `@better-auth/oauth-provider` instead. This plugin will be removed in the next major version.
* @see https://www.better-auth.com/docs/plugins/oauth-provider
*/
const oidcClient = () => {
	return {
		id: "oidc-client",
		version: PACKAGE_VERSION,
		$InferServerPlugin: {}
	};
};
//#endregion
export { oidcClient };

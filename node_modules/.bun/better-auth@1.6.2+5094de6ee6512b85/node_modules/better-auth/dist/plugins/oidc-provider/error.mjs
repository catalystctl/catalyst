import { APIError } from "@better-auth/core/error";
//#region src/plugins/oidc-provider/error.ts
var OIDCProviderError = class extends APIError {};
var InvalidRequest = class extends OIDCProviderError {
	constructor(error_description, error_detail) {
		super("BAD_REQUEST", {
			message: error_description,
			error: "invalid_request",
			error_description,
			error_detail
		});
	}
};
var InvalidClient = class extends OIDCProviderError {
	constructor(error_description) {
		super("BAD_REQUEST", {
			message: error_description,
			error: "invalid_client",
			error_description
		});
	}
};
//#endregion
export { InvalidClient, InvalidRequest };

import { base64Url } from "@better-auth/utils/base64";
import { betterFetch } from "@better-fetch/fetch";
//#region src/oauth2/client-credentials-token.ts
async function clientCredentialsTokenRequest({ options, scope, authentication, resource }) {
	options = typeof options === "function" ? await options() : options;
	return createClientCredentialsTokenRequest({
		options,
		scope,
		authentication,
		resource
	});
}
/**
* @deprecated use async'd clientCredentialsTokenRequest instead
*/
function createClientCredentialsTokenRequest({ options, scope, authentication, resource }) {
	const body = new URLSearchParams();
	const headers = {
		"content-type": "application/x-www-form-urlencoded",
		accept: "application/json"
	};
	body.set("grant_type", "client_credentials");
	scope && body.set("scope", scope);
	if (resource) if (typeof resource === "string") body.append("resource", resource);
	else for (const _resource of resource) body.append("resource", _resource);
	if (authentication === "basic") {
		const primaryClientId = Array.isArray(options.clientId) ? options.clientId[0] : options.clientId;
		headers["authorization"] = `Basic ${base64Url.encode(`${primaryClientId}:${options.clientSecret}`)}`;
	} else {
		const primaryClientId = Array.isArray(options.clientId) ? options.clientId[0] : options.clientId;
		body.set("client_id", primaryClientId);
		body.set("client_secret", options.clientSecret);
	}
	return {
		body,
		headers
	};
}
async function clientCredentialsToken({ options, tokenEndpoint, scope, authentication, resource }) {
	const { body, headers } = await clientCredentialsTokenRequest({
		options,
		scope,
		authentication,
		resource
	});
	const { data, error } = await betterFetch(tokenEndpoint, {
		method: "POST",
		body,
		headers
	});
	if (error) throw error;
	const tokens = {
		accessToken: data.access_token,
		tokenType: data.token_type,
		scopes: data.scope?.split(" ")
	};
	if (data.expires_in) {
		const now = /* @__PURE__ */ new Date();
		tokens.accessTokenExpiresAt = new Date(now.getTime() + data.expires_in * 1e3);
	}
	return tokens;
}
//#endregion
export { clientCredentialsToken, clientCredentialsTokenRequest, createClientCredentialsTokenRequest };

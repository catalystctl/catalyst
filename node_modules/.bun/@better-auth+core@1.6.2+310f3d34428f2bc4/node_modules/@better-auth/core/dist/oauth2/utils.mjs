import { base64Url } from "@better-auth/utils/base64";
//#region src/oauth2/utils.ts
function getOAuth2Tokens(data) {
	const getDate = (seconds) => {
		const now = /* @__PURE__ */ new Date();
		return new Date(now.getTime() + seconds * 1e3);
	};
	return {
		tokenType: data.token_type,
		accessToken: data.access_token,
		refreshToken: data.refresh_token,
		accessTokenExpiresAt: data.expires_in ? getDate(data.expires_in) : void 0,
		refreshTokenExpiresAt: data.refresh_token_expires_in ? getDate(data.refresh_token_expires_in) : void 0,
		scopes: data?.scope ? typeof data.scope === "string" ? data.scope.split(" ") : data.scope : [],
		idToken: data.id_token,
		raw: data
	};
}
async function generateCodeChallenge(codeVerifier) {
	const data = new TextEncoder().encode(codeVerifier);
	const hash = await crypto.subtle.digest("SHA-256", data);
	return base64Url.encode(new Uint8Array(hash), { padding: false });
}
//#endregion
export { generateCodeChallenge, getOAuth2Tokens };

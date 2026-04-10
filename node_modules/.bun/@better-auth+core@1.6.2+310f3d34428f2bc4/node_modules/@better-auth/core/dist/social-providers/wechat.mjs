import { betterFetch } from "@better-fetch/fetch";
//#region src/social-providers/wechat.ts
const wechat = (options) => {
	return {
		id: "wechat",
		name: "WeChat",
		createAuthorizationURL({ state, scopes, redirectURI }) {
			const _scopes = options.disableDefaultScope ? [] : ["snsapi_login"];
			options.scope && _scopes.push(...options.scope);
			scopes && _scopes.push(...scopes);
			const url = new URL("https://open.weixin.qq.com/connect/qrconnect");
			url.searchParams.set("scope", _scopes.join(","));
			url.searchParams.set("response_type", "code");
			url.searchParams.set("appid", options.clientId);
			url.searchParams.set("redirect_uri", options.redirectURI || redirectURI);
			url.searchParams.set("state", state);
			url.searchParams.set("lang", options.lang || "cn");
			url.hash = "wechat_redirect";
			return url;
		},
		validateAuthorizationCode: async ({ code }) => {
			const { data: tokenData, error } = await betterFetch("https://api.weixin.qq.com/sns/oauth2/access_token?" + new URLSearchParams({
				appid: options.clientId,
				secret: options.clientSecret,
				code,
				grant_type: "authorization_code"
			}).toString(), { method: "GET" });
			if (error || !tokenData || tokenData.errcode) throw new Error(`Failed to validate authorization code: ${tokenData?.errmsg || error?.message || "Unknown error"}`);
			return {
				tokenType: "Bearer",
				accessToken: tokenData.access_token,
				refreshToken: tokenData.refresh_token,
				accessTokenExpiresAt: new Date(Date.now() + tokenData.expires_in * 1e3),
				scopes: tokenData.scope.split(","),
				openid: tokenData.openid,
				unionid: tokenData.unionid
			};
		},
		refreshAccessToken: options.refreshAccessToken ? options.refreshAccessToken : async (refreshToken) => {
			const { data: tokenData, error } = await betterFetch("https://api.weixin.qq.com/sns/oauth2/refresh_token?" + new URLSearchParams({
				appid: options.clientId,
				grant_type: "refresh_token",
				refresh_token: refreshToken
			}).toString(), { method: "GET" });
			if (error || !tokenData || tokenData.errcode) throw new Error(`Failed to refresh access token: ${tokenData?.errmsg || error?.message || "Unknown error"}`);
			return {
				tokenType: "Bearer",
				accessToken: tokenData.access_token,
				refreshToken: tokenData.refresh_token,
				accessTokenExpiresAt: new Date(Date.now() + tokenData.expires_in * 1e3),
				scopes: tokenData.scope.split(",")
			};
		},
		async getUserInfo(token) {
			if (options.getUserInfo) return options.getUserInfo(token);
			const openid = token.openid;
			if (!openid) return null;
			const { data: profile, error } = await betterFetch("https://api.weixin.qq.com/sns/userinfo?" + new URLSearchParams({
				access_token: token.accessToken || "",
				openid,
				lang: "zh_CN"
			}).toString(), { method: "GET" });
			if (error || !profile || profile.errcode) return null;
			const userMap = await options.mapProfileToUser?.(profile);
			return {
				user: {
					id: profile.unionid || profile.openid || openid,
					name: profile.nickname,
					email: profile.email || null,
					image: profile.headimgurl,
					emailVerified: false,
					...userMap
				},
				data: profile
			};
		},
		options
	};
};
//#endregion
export { wechat };

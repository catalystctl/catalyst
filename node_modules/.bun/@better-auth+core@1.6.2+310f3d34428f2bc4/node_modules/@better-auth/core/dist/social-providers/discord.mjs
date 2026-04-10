import { refreshAccessToken } from "../oauth2/refresh-access-token.mjs";
import { validateAuthorizationCode } from "../oauth2/validate-authorization-code.mjs";
import { betterFetch } from "@better-fetch/fetch";
//#region src/social-providers/discord.ts
const discord = (options) => {
	const tokenEndpoint = "https://discord.com/api/oauth2/token";
	return {
		id: "discord",
		name: "Discord",
		createAuthorizationURL({ state, scopes, redirectURI }) {
			const _scopes = options.disableDefaultScope ? [] : ["identify", "email"];
			if (scopes) _scopes.push(...scopes);
			if (options.scope) _scopes.push(...options.scope);
			const permissionsParam = _scopes.includes("bot") && options.permissions !== void 0 ? `&permissions=${options.permissions}` : "";
			return new URL(`https://discord.com/api/oauth2/authorize?scope=${_scopes.join("+")}&response_type=code&client_id=${options.clientId}&redirect_uri=${encodeURIComponent(options.redirectURI || redirectURI)}&state=${state}&prompt=${options.prompt || "none"}${permissionsParam}`);
		},
		validateAuthorizationCode: async ({ code, redirectURI }) => {
			return validateAuthorizationCode({
				code,
				redirectURI,
				options,
				tokenEndpoint
			});
		},
		refreshAccessToken: options.refreshAccessToken ? options.refreshAccessToken : async (refreshToken) => {
			return refreshAccessToken({
				refreshToken,
				options: {
					clientId: options.clientId,
					clientKey: options.clientKey,
					clientSecret: options.clientSecret
				},
				tokenEndpoint
			});
		},
		async getUserInfo(token) {
			if (options.getUserInfo) return options.getUserInfo(token);
			const { data: profile, error } = await betterFetch("https://discord.com/api/users/@me", { headers: { authorization: `Bearer ${token.accessToken}` } });
			if (error) return null;
			if (profile.avatar === null) profile.image_url = `https://cdn.discordapp.com/embed/avatars/${profile.discriminator === "0" ? Number(BigInt(profile.id) >> BigInt(22)) % 6 : parseInt(profile.discriminator) % 5}.png`;
			else {
				const format = profile.avatar.startsWith("a_") ? "gif" : "png";
				profile.image_url = `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.${format}`;
			}
			const userMap = await options.mapProfileToUser?.(profile);
			return {
				user: {
					id: profile.id,
					name: profile.global_name || profile.username || "",
					email: profile.email,
					emailVerified: profile.verified,
					image: profile.image_url,
					...userMap
				},
				data: profile
			};
		},
		options
	};
};
//#endregion
export { discord };

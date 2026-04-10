import { PACKAGE_VERSION } from "../../version.mjs";
import { createAuthMiddleware } from "@better-auth/core/api";
//#region src/plugins/last-login-method/index.ts
/**
* Plugin to track the last used login method
*/
const lastLoginMethod = (userConfig) => {
	const defaultResolveMethod = (ctx) => {
		const path = ctx.path;
		if (!path) return null;
		if (path.startsWith("/callback/") || path.startsWith("/oauth2/callback/")) return ctx.params?.id || ctx.params?.providerId || path.split("/").pop();
		if (path === "/sign-in/email" || path === "/sign-up/email") return "email";
		if (path.includes("siwe")) return "siwe";
		if (path.includes("/passkey/verify-authentication")) return "passkey";
		if (path.startsWith("/magic-link/verify")) return "magic-link";
		return null;
	};
	const getResolveContext = (ctx) => {
		return ctx.path ? ctx : {
			...ctx,
			path: ""
		};
	};
	const resolveMethod = (ctx) => {
		const resolveContext = getResolveContext(ctx);
		return config.customResolveMethod?.(resolveContext) ?? defaultResolveMethod(resolveContext);
	};
	const config = {
		cookieName: "better-auth.last_used_login_method",
		maxAge: 3600 * 24 * 30,
		...userConfig
	};
	return {
		id: "last-login-method",
		version: PACKAGE_VERSION,
		init(ctx) {
			return { options: { databaseHooks: {
				user: { create: { async before(user, context) {
					if (!config.storeInDatabase) return;
					if (!context) return;
					const lastUsedLoginMethod = resolveMethod(context);
					if (lastUsedLoginMethod) return { data: {
						...user,
						lastLoginMethod: lastUsedLoginMethod
					} };
				} } },
				session: { create: { async after(session, context) {
					if (!config.storeInDatabase) return;
					if (!context) return;
					const lastUsedLoginMethod = resolveMethod(context);
					if (lastUsedLoginMethod && session?.userId) try {
						await ctx.internalAdapter.updateUser(session.userId, { lastLoginMethod: lastUsedLoginMethod });
					} catch (error) {
						ctx.logger.error("Failed to update lastLoginMethod", error);
					}
				} } }
			} } };
		},
		hooks: { after: [{
			matcher() {
				return true;
			},
			handler: createAuthMiddleware(async (ctx) => {
				const lastUsedLoginMethod = resolveMethod(ctx);
				if (lastUsedLoginMethod) {
					const setCookieHeaders = ctx.context.responseHeaders?.getSetCookie?.() || [];
					const sessionTokenName = ctx.context.authCookies.sessionToken.name;
					if (setCookieHeaders.some((cookie) => cookie.includes(sessionTokenName))) {
						const cookieAttributes = {
							...ctx.context.authCookies.sessionToken.attributes,
							maxAge: config.maxAge,
							httpOnly: false
						};
						ctx.setCookie(config.cookieName, lastUsedLoginMethod, cookieAttributes);
					}
				}
			})
		}] },
		schema: config.storeInDatabase ? { user: { fields: { lastLoginMethod: {
			type: "string",
			input: false,
			required: false,
			fieldName: config.schema?.user?.lastLoginMethod || "lastLoginMethod"
		} } } } : void 0,
		options: userConfig
	};
};
//#endregion
export { lastLoginMethod };

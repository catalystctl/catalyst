import { isDynamicBaseURLConfig } from "../utils/url.mjs";
import { getDate } from "../utils/date.mjs";
import { parseUserOutput } from "../db/schema.mjs";
import { isPromise } from "../utils/is-promise.mjs";
import { signJWT, symmetricDecodeJWT, symmetricEncodeJWT, verifyJWT } from "../crypto/jwt.mjs";
import { createAccountStore, createSessionStore, getAccountCookie, getChunkedCookie, setAccountCookie } from "./session-store.mjs";
import { sec } from "../utils/time.mjs";
import { HOST_COOKIE_PREFIX, SECURE_COOKIE_PREFIX, parseSetCookieHeader, setCookieToHeader, splitSetCookieHeader, stripSecureCookiePrefix } from "./cookie-utils.mjs";
import { env, isProduction } from "@better-auth/core/env";
import { BetterAuthError } from "@better-auth/core/error";
import { safeJSONParse } from "@better-auth/core/utils/json";
import { filterOutputFields } from "@better-auth/core/utils/db";
import { base64Url } from "@better-auth/utils/base64";
import { binary } from "@better-auth/utils/binary";
import { createHMAC } from "@better-auth/utils/hmac";
//#region src/cookies/index.ts
function createCookieGetter(options) {
	const baseURLString = typeof options.baseURL === "string" ? options.baseURL : void 0;
	const dynamicProtocol = typeof options.baseURL === "object" && options.baseURL !== null ? options.baseURL.protocol : void 0;
	const secureCookiePrefix = (options.advanced?.useSecureCookies !== void 0 ? options.advanced?.useSecureCookies : dynamicProtocol === "https" ? true : dynamicProtocol === "http" ? false : baseURLString ? baseURLString.startsWith("https://") : isProduction) ? SECURE_COOKIE_PREFIX : "";
	const crossSubdomainEnabled = !!options.advanced?.crossSubDomainCookies?.enabled;
	const domain = crossSubdomainEnabled ? options.advanced?.crossSubDomainCookies?.domain || (baseURLString ? new URL(baseURLString).hostname : void 0) : void 0;
	if (crossSubdomainEnabled && !domain && !isDynamicBaseURLConfig(options.baseURL)) throw new BetterAuthError("baseURL is required when crossSubdomainCookies are enabled.");
	function createCookie(cookieName, overrideAttributes = {}) {
		const prefix = options.advanced?.cookiePrefix || "better-auth";
		const name = options.advanced?.cookies?.[cookieName]?.name || `${prefix}.${cookieName}`;
		const attributes = options.advanced?.cookies?.[cookieName]?.attributes ?? {};
		return {
			name: `${secureCookiePrefix}${name}`,
			attributes: {
				secure: !!secureCookiePrefix,
				sameSite: "lax",
				path: "/",
				httpOnly: true,
				...crossSubdomainEnabled ? { domain } : {},
				...options.advanced?.defaultCookieAttributes,
				...overrideAttributes,
				...attributes
			}
		};
	}
	return createCookie;
}
function getCookies(options) {
	const createCookie = createCookieGetter(options);
	const sessionToken = createCookie("session_token", { maxAge: options.session?.expiresIn || sec("7d") });
	const sessionData = createCookie("session_data", { maxAge: options.session?.cookieCache?.maxAge || 300 });
	const accountData = createCookie("account_data", { maxAge: options.session?.cookieCache?.maxAge || 300 });
	const dontRememberToken = createCookie("dont_remember");
	return {
		sessionToken: {
			name: sessionToken.name,
			attributes: sessionToken.attributes
		},
		sessionData: {
			name: sessionData.name,
			attributes: sessionData.attributes
		},
		dontRememberToken: {
			name: dontRememberToken.name,
			attributes: dontRememberToken.attributes
		},
		accountData: {
			name: accountData.name,
			attributes: accountData.attributes
		}
	};
}
async function setCookieCache(ctx, session, dontRememberMe) {
	if (!ctx.context.options.session?.cookieCache?.enabled) return;
	const filteredSession = filterOutputFields(session.session, ctx.context.options.session?.additionalFields);
	const filteredUser = parseUserOutput(ctx.context.options, session.user);
	const versionConfig = ctx.context.options.session?.cookieCache?.version;
	let version = "1";
	if (versionConfig) {
		if (typeof versionConfig === "string") version = versionConfig;
		else if (typeof versionConfig === "function") {
			const result = versionConfig(session.session, session.user);
			version = isPromise(result) ? await result : result;
		}
	}
	const sessionData = {
		session: filteredSession,
		user: filteredUser,
		updatedAt: Date.now(),
		version
	};
	const options = {
		...ctx.context.authCookies.sessionData.attributes,
		maxAge: dontRememberMe ? void 0 : ctx.context.authCookies.sessionData.attributes.maxAge
	};
	const expiresAtDate = getDate(options.maxAge || 60, "sec").getTime();
	const strategy = ctx.context.options.session?.cookieCache?.strategy || "compact";
	let data;
	if (strategy === "jwe") data = await symmetricEncodeJWT(sessionData, ctx.context.secretConfig, "better-auth-session", options.maxAge || 300);
	else if (strategy === "jwt") data = await signJWT(sessionData, ctx.context.secret, options.maxAge || 300);
	else data = base64Url.encode(JSON.stringify({
		session: sessionData,
		expiresAt: expiresAtDate,
		signature: await createHMAC("SHA-256", "base64urlnopad").sign(ctx.context.secret, JSON.stringify({
			...sessionData,
			expiresAt: expiresAtDate
		}))
	}), { padding: false });
	if (data.length > 4093) {
		const sessionStore = createSessionStore(ctx.context.authCookies.sessionData.name, options, ctx);
		const cookies = sessionStore.chunk(data, options);
		sessionStore.setCookies(cookies);
	} else {
		const sessionStore = createSessionStore(ctx.context.authCookies.sessionData.name, options, ctx);
		if (sessionStore.hasChunks()) {
			const cleanCookies = sessionStore.clean();
			sessionStore.setCookies(cleanCookies);
		}
		ctx.setCookie(ctx.context.authCookies.sessionData.name, data, options);
	}
	if (ctx.context.options.account?.storeAccountCookie) {
		const accountData = await getAccountCookie(ctx);
		if (accountData) await setAccountCookie(ctx, accountData);
	}
}
async function setSessionCookie(ctx, session, dontRememberMe, overrides) {
	const dontRememberMeCookie = await ctx.getSignedCookie(ctx.context.authCookies.dontRememberToken.name, ctx.context.secret);
	dontRememberMe = dontRememberMe !== void 0 ? dontRememberMe : !!dontRememberMeCookie;
	const options = ctx.context.authCookies.sessionToken.attributes;
	const maxAge = dontRememberMe ? void 0 : ctx.context.sessionConfig.expiresIn;
	await ctx.setSignedCookie(ctx.context.authCookies.sessionToken.name, session.session.token, ctx.context.secret, {
		...options,
		maxAge,
		...overrides
	});
	if (dontRememberMe) await ctx.setSignedCookie(ctx.context.authCookies.dontRememberToken.name, "true", ctx.context.secret, ctx.context.authCookies.dontRememberToken.attributes);
	await setCookieCache(ctx, session, dontRememberMe);
	ctx.context.setNewSession(session);
}
/**
* Expires a cookie by setting `maxAge: 0` while preserving its attributes
*/
function expireCookie(ctx, cookie) {
	ctx.setCookie(cookie.name, "", {
		...cookie.attributes,
		maxAge: 0
	});
}
function deleteSessionCookie(ctx, skipDontRememberMe) {
	expireCookie(ctx, ctx.context.authCookies.sessionToken);
	expireCookie(ctx, ctx.context.authCookies.sessionData);
	if (ctx.context.options.account?.storeAccountCookie) {
		expireCookie(ctx, ctx.context.authCookies.accountData);
		const accountStore = createAccountStore(ctx.context.authCookies.accountData.name, ctx.context.authCookies.accountData.attributes, ctx);
		const cleanCookies = accountStore.clean();
		accountStore.setCookies(cleanCookies);
	}
	if (ctx.context.oauthConfig.storeStateStrategy === "cookie") expireCookie(ctx, ctx.context.createAuthCookie("oauth_state"));
	const sessionStore = createSessionStore(ctx.context.authCookies.sessionData.name, ctx.context.authCookies.sessionData.attributes, ctx);
	const cleanCookies = sessionStore.clean();
	sessionStore.setCookies(cleanCookies);
	if (!skipDontRememberMe) expireCookie(ctx, ctx.context.authCookies.dontRememberToken);
}
function parseCookies(cookieHeader) {
	const cookies = cookieHeader.split("; ");
	const cookieMap = /* @__PURE__ */ new Map();
	cookies.forEach((cookie) => {
		const [name, value] = cookie.split(/=(.*)/s);
		cookieMap.set(name, value);
	});
	return cookieMap;
}
const getSessionCookie = (request, config) => {
	const cookies = (request instanceof Headers || !("headers" in request) ? request : request.headers).get("cookie");
	if (!cookies) return null;
	const { cookieName = "session_token", cookiePrefix = "better-auth" } = config || {};
	const parsedCookie = parseCookies(cookies);
	const getCookie = (name) => parsedCookie.get(name) || parsedCookie.get(`__Secure-${name}`);
	const sessionToken = getCookie(`${cookiePrefix}.${cookieName}`) || getCookie(`${cookiePrefix}-${cookieName}`);
	if (sessionToken) return sessionToken;
	return null;
};
const getCookieCache = async (request, config) => {
	const cookies = (request instanceof Headers || !("headers" in request) ? request : request.headers).get("cookie");
	if (!cookies) return null;
	const { cookieName = "session_data", cookiePrefix = "better-auth" } = config || {};
	const name = config?.isSecure !== void 0 ? config.isSecure ? `${SECURE_COOKIE_PREFIX}${cookiePrefix}.${cookieName}` : `${cookiePrefix}.${cookieName}` : isProduction ? `${SECURE_COOKIE_PREFIX}${cookiePrefix}.${cookieName}` : `${cookiePrefix}.${cookieName}`;
	const parsedCookie = parseCookies(cookies);
	let sessionData = parsedCookie.get(name);
	if (!sessionData) {
		const chunks = [];
		for (const [cookieName, value] of parsedCookie.entries()) if (cookieName.startsWith(name + ".")) {
			const parts = cookieName.split(".");
			const indexStr = parts[parts.length - 1];
			const index = parseInt(indexStr || "0", 10);
			if (!isNaN(index)) chunks.push({
				index,
				value
			});
		}
		if (chunks.length > 0) {
			chunks.sort((a, b) => a.index - b.index);
			sessionData = chunks.map((c) => c.value).join("");
		}
	}
	if (sessionData) {
		const secret = config?.secret || env.BETTER_AUTH_SECRET;
		if (!secret) throw new BetterAuthError("getCookieCache requires a secret to be provided. Either pass it as an option or set the BETTER_AUTH_SECRET environment variable");
		const strategy = config?.strategy || "compact";
		if (strategy === "jwe") {
			const payload = await symmetricDecodeJWT(sessionData, secret, "better-auth-session");
			if (payload && payload.session && payload.user) {
				if (config?.version) {
					const cookieVersion = payload.version || "1";
					let expectedVersion = "1";
					if (typeof config.version === "string") expectedVersion = config.version;
					else if (typeof config.version === "function") {
						const result = config.version(payload.session, payload.user);
						expectedVersion = isPromise(result) ? await result : result;
					}
					if (cookieVersion !== expectedVersion) return null;
				}
				return payload;
			}
			return null;
		} else if (strategy === "jwt") {
			const payload = await verifyJWT(sessionData, secret);
			if (payload && payload.session && payload.user) {
				if (config?.version) {
					const cookieVersion = payload.version || "1";
					let expectedVersion = "1";
					if (typeof config.version === "string") expectedVersion = config.version;
					else if (typeof config.version === "function") {
						const result = config.version(payload.session, payload.user);
						expectedVersion = isPromise(result) ? await result : result;
					}
					if (cookieVersion !== expectedVersion) return null;
				}
				return payload;
			}
			return null;
		} else {
			const sessionDataPayload = safeJSONParse(binary.decode(base64Url.decode(sessionData)));
			if (!sessionDataPayload) return null;
			if (!await createHMAC("SHA-256", "base64urlnopad").verify(secret, JSON.stringify({
				...sessionDataPayload.session,
				expiresAt: sessionDataPayload.expiresAt
			}), sessionDataPayload.signature)) return null;
			if (config?.version && sessionDataPayload.session) {
				const cookieVersion = sessionDataPayload.session.version || "1";
				let expectedVersion = "1";
				if (typeof config.version === "string") expectedVersion = config.version;
				else if (typeof config.version === "function") {
					const result = config.version(sessionDataPayload.session.session, sessionDataPayload.session.user);
					expectedVersion = isPromise(result) ? await result : result;
				}
				if (cookieVersion !== expectedVersion) return null;
			}
			return sessionDataPayload.session;
		}
	}
	return null;
};
//#endregion
export { HOST_COOKIE_PREFIX, SECURE_COOKIE_PREFIX, createCookieGetter, createSessionStore, deleteSessionCookie, expireCookie, getAccountCookie, getChunkedCookie, getCookieCache, getCookies, getSessionCookie, parseCookies, parseSetCookieHeader, setCookieCache, setCookieToHeader, setSessionCookie, splitSetCookieHeader, stripSecureCookiePrefix };

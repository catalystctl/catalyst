import { getOrigin } from "../../utils/url.mjs";
import { originCheck } from "../../api/middlewares/origin-check.mjs";
import { symmetricDecrypt, symmetricEncrypt } from "../../crypto/index.mjs";
import { parseSetCookieHeader } from "../../cookies/cookie-utils.mjs";
import { setSessionCookie } from "../../cookies/index.mjs";
import { parseGenericState } from "../../state.mjs";
import { handleOAuthUserInfo } from "../../oauth2/link-account.mjs";
import { PACKAGE_VERSION } from "../../version.mjs";
import { parseJSON } from "../../client/parser.mjs";
import { checkSkipProxy, redirectOnError, resolveCurrentURL, stripTrailingSlash } from "./utils.mjs";
import { defu } from "defu";
import { createAuthEndpoint, createAuthMiddleware } from "@better-auth/core/api";
import * as z from "zod";
//#region src/plugins/oauth-proxy/index.ts
const oauthProxyQuerySchema = z.object({
	callbackURL: z.string().meta({ description: "The URL to redirect to after the proxy" }),
	profile: z.string().optional().meta({ description: "Encrypted OAuth profile data" })
});
const oauthCallbackQuerySchema = z.object({
	code: z.string().optional(),
	error: z.string().optional()
});
const oAuthProxy = (opts) => {
	const maxAge = opts?.maxAge ?? 60;
	const getEncryptionKey = (ctx) => opts?.secret ?? ctx.context.secretConfig;
	return {
		id: "oauth-proxy",
		version: PACKAGE_VERSION,
		options: opts,
		endpoints: { oAuthProxy: createAuthEndpoint("/oauth-proxy-callback", {
			method: "GET",
			operationId: "oauthProxyCallback",
			query: oauthProxyQuerySchema,
			use: [originCheck((ctx) => ctx.query.callbackURL)],
			metadata: { openapi: {
				operationId: "oauthProxyCallback",
				description: "OAuth Proxy Callback",
				parameters: [{
					in: "query",
					name: "callbackURL",
					required: true,
					description: "The URL to redirect to after the proxy"
				}, {
					in: "query",
					name: "profile",
					required: false,
					description: "Encrypted OAuth profile data"
				}],
				responses: { 302: {
					description: "Redirect",
					headers: { Location: {
						description: "The URL to redirect to",
						schema: { type: "string" }
					} }
				} }
			} }
		}, async (ctx) => {
			const baseURLStr = typeof ctx.context.options.baseURL === "string" ? ctx.context.options.baseURL : getOrigin(ctx.context.baseURL) || "";
			const defaultErrorURL = ctx.context.options.onAPIError?.errorURL || `${stripTrailingSlash(baseURLStr)}/api/auth/error`;
			const encryptedProfile = ctx.query.profile;
			if (!encryptedProfile) {
				ctx.context.logger.error("OAuth proxy callback missing profile data");
				throw redirectOnError(ctx, defaultErrorURL, "missing_profile");
			}
			let decryptedPayload;
			try {
				decryptedPayload = await symmetricDecrypt({
					key: getEncryptionKey(ctx),
					data: encryptedProfile
				});
			} catch (e) {
				ctx.context.logger.error("Failed to decrypt OAuth proxy profile", e);
				throw redirectOnError(ctx, defaultErrorURL, "invalid_profile");
			}
			let payload;
			try {
				payload = parseJSON(decryptedPayload);
			} catch (e) {
				ctx.context.logger.error("Failed to parse OAuth proxy payload", e);
				throw redirectOnError(ctx, defaultErrorURL, "invalid_payload");
			}
			if (typeof payload.timestamp !== "number" || !payload.userInfo || !payload.account || !payload.callbackURL) {
				ctx.context.logger.error("Failed to parse OAuth proxy payload");
				throw redirectOnError(ctx, defaultErrorURL, "invalid_payload");
			}
			const errorURL = payload.errorURL || defaultErrorURL;
			const age = (Date.now() - payload.timestamp) / 1e3;
			if (age > maxAge || age < -10) {
				ctx.context.logger.error(`OAuth proxy payload expired or invalid (age: ${age}s, maxAge: ${maxAge}s)`);
				throw redirectOnError(ctx, errorURL, "payload_expired");
			}
			try {
				await parseGenericState(ctx, payload.state);
			} catch (e) {
				ctx.context.logger.warn("Failed to clean up OAuth state", e);
			}
			const result = await handleOAuthUserInfo(ctx, {
				userInfo: payload.userInfo,
				account: payload.account,
				callbackURL: payload.callbackURL,
				disableSignUp: payload.disableSignUp
			});
			if (result.error || !result.data) {
				ctx.context.logger.error("Failed to create user or session", result.error);
				throw redirectOnError(ctx, errorURL, "user_creation_failed");
			}
			await setSessionCookie(ctx, result.data);
			const finalURL = result.isRegister ? payload.newUserURL || payload.callbackURL : payload.callbackURL;
			throw ctx.redirect(finalURL);
		}) },
		hooks: {
			before: [{
				matcher(context) {
					return !!(context.path?.startsWith("/sign-in/social") || context.path?.startsWith("/sign-in/oauth2"));
				},
				handler: createAuthMiddleware(async (ctx) => {
					if (checkSkipProxy(ctx, opts)) return;
					const currentURL = resolveCurrentURL(ctx, opts);
					const productionURL = opts?.productionURL;
					const originalCallbackURL = ctx.body?.callbackURL || ctx.context.baseURL;
					if (productionURL) {
						const productionBaseURL = `${stripTrailingSlash(productionURL)}${ctx.context.options.basePath || "/api/auth"}`;
						ctx.context.baseURL = productionBaseURL;
					}
					const newCallbackURL = `${stripTrailingSlash(currentURL.origin)}${ctx.context.options.basePath || "/api/auth"}/oauth-proxy-callback?callbackURL=${encodeURIComponent(originalCallbackURL)}`;
					if (!ctx.body) return;
					ctx.body.callbackURL = newCallbackURL;
				})
			}, {
				matcher(context) {
					return context.path === "/callback/:id";
				},
				handler: createAuthMiddleware(async (ctx) => {
					const callbackParams = defu(ctx.query, ctx.body);
					const state = callbackParams.state;
					if (!state || typeof state !== "string") return;
					let statePackage;
					try {
						statePackage = parseJSON(await symmetricDecrypt({
							key: getEncryptionKey(ctx),
							data: state
						}));
					} catch {
						return;
					}
					if (!statePackage.isOAuthProxy || !statePackage.state || !statePackage.stateCookie) {
						ctx.context.logger.warn("Invalid OAuth proxy state package");
						return;
					}
					const query = oauthCallbackQuerySchema.safeParse(callbackParams);
					if (!query.success) {
						ctx.context.logger.warn("Invalid OAuth callback query", query.error);
						return;
					}
					const { code, error } = query.data;
					let stateData;
					try {
						stateData = parseJSON(await symmetricDecrypt({
							key: getEncryptionKey(ctx),
							data: statePackage.stateCookie
						}));
					} catch (e) {
						ctx.context.logger.error("Failed to decrypt OAuth proxy state cookie:", e);
						return;
					}
					const errorURL = stateData.errorURL || ctx.context.options.onAPIError?.errorURL || `${ctx.context.baseURL}/error`;
					if (stateData.oauthState !== void 0 && stateData.oauthState !== statePackage.state) {
						ctx.context.logger.error("OAuth proxy state binding mismatch");
						throw redirectOnError(ctx, errorURL, "state_mismatch");
					}
					if (error) throw redirectOnError(ctx, errorURL, error);
					if (!code) {
						ctx.context.logger.error("OAuth callback missing authorization code");
						throw redirectOnError(ctx, errorURL, "no_code");
					}
					const providerId = ctx.params?.id;
					const provider = ctx.context.socialProviders.find((p) => p.id === providerId);
					if (!provider) {
						ctx.context.logger.error("OAuth provider not found", providerId);
						throw redirectOnError(ctx, errorURL, "oauth_provider_not_found");
					}
					let tokens;
					try {
						tokens = await provider.validateAuthorizationCode({
							code,
							codeVerifier: stateData.codeVerifier,
							redirectURI: `${ctx.context.baseURL}/callback/${provider.id}`
						});
					} catch (e) {
						ctx.context.logger.error("Failed to validate authorization code", e);
						throw redirectOnError(ctx, errorURL, "invalid_code");
					}
					if (!tokens) throw redirectOnError(ctx, errorURL, "invalid_code");
					const userInfo = (await provider.getUserInfo(tokens))?.user;
					if (!userInfo) {
						ctx.context.logger.error("Unable to get user info from provider");
						throw redirectOnError(ctx, errorURL, "unable_to_get_user_info");
					}
					if (!userInfo.email) {
						ctx.context.logger.error("Provider did not return email");
						throw redirectOnError(ctx, errorURL, "email_not_found");
					}
					const proxyCallbackURL = new URL(stateData.callbackURL);
					const finalCallbackURL = proxyCallbackURL.searchParams.get("callbackURL") || stateData.callbackURL;
					const payload = {
						userInfo: {
							id: String(userInfo.id),
							email: userInfo.email,
							name: userInfo.name || "",
							image: userInfo.image,
							emailVerified: userInfo.emailVerified
						},
						account: {
							providerId: provider.id,
							accountId: String(userInfo.id),
							accessToken: tokens.accessToken,
							refreshToken: tokens.refreshToken,
							idToken: tokens.idToken,
							accessTokenExpiresAt: tokens.accessTokenExpiresAt,
							refreshTokenExpiresAt: tokens.refreshTokenExpiresAt,
							scope: tokens.scopes?.join(",")
						},
						state: statePackage.state,
						callbackURL: finalCallbackURL,
						newUserURL: stateData.newUserURL,
						errorURL: stateData.errorURL,
						disableSignUp: provider.disableImplicitSignUp && !stateData.requestSignUp || provider.options?.disableSignUp,
						timestamp: Date.now()
					};
					const encryptedPayload = await symmetricEncrypt({
						key: getEncryptionKey(ctx),
						data: JSON.stringify(payload)
					});
					proxyCallbackURL.searchParams.set("profile", encryptedPayload);
					throw ctx.redirect(proxyCallbackURL.toString());
				})
			}],
			after: [{
				matcher(context) {
					return !!(context.path?.startsWith("/sign-in/social") || context.path?.startsWith("/sign-in/oauth2"));
				},
				handler: createAuthMiddleware(async (ctx) => {
					if (checkSkipProxy(ctx, opts)) return;
					const signInResponse = ctx.context.returned;
					if (!signInResponse || typeof signInResponse !== "object" || !("url" in signInResponse)) return;
					const { url: providerURL } = signInResponse;
					if (typeof providerURL !== "string") return;
					const oauthURL = new URL(providerURL);
					const originalState = oauthURL.searchParams.get("state");
					if (!originalState) return;
					let stateCookieValue;
					if (ctx.context.oauthConfig.storeStateStrategy === "cookie") {
						const setCookieHeader = ctx.context.responseHeaders?.get("set-cookie");
						if (setCookieHeader) {
							const parsedCookies = parseSetCookieHeader(setCookieHeader);
							const stateCookie = ctx.context.createAuthCookie("oauth_state");
							stateCookieValue = parsedCookies.get(stateCookie.name)?.value;
						}
					} else {
						const verification = await ctx.context.internalAdapter.findVerificationValue(originalState);
						if (verification) stateCookieValue = await symmetricEncrypt({
							key: getEncryptionKey(ctx),
							data: verification.value
						});
					}
					if (!stateCookieValue) {
						ctx.context.logger.warn("No OAuth state cookie value found");
						return;
					}
					try {
						const statePackage = {
							state: originalState,
							stateCookie: stateCookieValue,
							isOAuthProxy: true
						};
						const encryptedPackage = await symmetricEncrypt({
							key: getEncryptionKey(ctx),
							data: JSON.stringify(statePackage)
						});
						oauthURL.searchParams.set("state", encryptedPackage);
						ctx.context.returned = {
							...signInResponse,
							url: oauthURL.toString()
						};
					} catch (e) {
						ctx.context.logger.error("Failed to encrypt OAuth proxy state package:", e);
					}
				})
			}, {
				matcher(context) {
					return context.path === "/callback/:id";
				},
				handler: createAuthMiddleware(async (ctx) => {
					const location = ctx.context.responseHeaders?.get("location");
					if (!location?.includes("/oauth-proxy-callback?callbackURL") || !location.startsWith("http")) return;
					const productionOrigin = getOrigin(opts?.productionURL || (typeof ctx.context.options.baseURL === "string" ? ctx.context.options.baseURL : void 0) || ctx.context.baseURL);
					const locationURL = new URL(location);
					if (locationURL.origin === productionOrigin) {
						const newLocation = locationURL.searchParams.get("callbackURL");
						if (!newLocation) return;
						ctx.setHeader("location", newLocation);
						return;
					}
					ctx.context.logger.warn("OAuth proxy: cross-origin callback reached after hook unexpectedly");
				})
			}]
		}
	};
};
//#endregion
export { oAuthProxy };

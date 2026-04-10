import { getBaseURL, getOrigin, isDynamicBaseURLConfig, resolveBaseURL } from "../utils/url.mjs";
import { getTrustedOrigins, getTrustedProviders } from "../context/helpers.mjs";
import { createCookieGetter, getCookies } from "../cookies/index.mjs";
import { getEndpoints, router } from "../api/index.mjs";
import { runWithAdapter } from "@better-auth/core/context";
import { BASE_ERROR_CODES, BetterAuthError } from "@better-auth/core/error";
//#region src/auth/base.ts
const createBetterAuth = (options, initFn) => {
	const authContext = initFn(options);
	const { api } = getEndpoints(authContext, options);
	return {
		handler: async (request) => {
			const ctx = await authContext;
			const basePath = ctx.options.basePath || "/api/auth";
			let handlerCtx;
			if (isDynamicBaseURLConfig(options.baseURL)) {
				handlerCtx = Object.create(Object.getPrototypeOf(ctx), Object.getOwnPropertyDescriptors(ctx));
				const baseURL = resolveBaseURL(options.baseURL, basePath, request);
				if (baseURL) {
					handlerCtx.baseURL = baseURL;
					handlerCtx.options = {
						...ctx.options,
						baseURL: getOrigin(baseURL) || void 0
					};
				} else throw new BetterAuthError("Could not resolve base URL from request. Check your allowedHosts config.");
				const trustedOriginOptions = {
					...handlerCtx.options,
					baseURL: options.baseURL
				};
				handlerCtx.trustedOrigins = await getTrustedOrigins(trustedOriginOptions, request);
				if (options.advanced?.crossSubDomainCookies?.enabled) {
					handlerCtx.authCookies = getCookies(handlerCtx.options);
					handlerCtx.createAuthCookie = createCookieGetter(handlerCtx.options);
				}
			} else {
				handlerCtx = ctx;
				if (!ctx.options.baseURL) {
					const baseURL = getBaseURL(void 0, basePath, request, void 0, ctx.options.advanced?.trustedProxyHeaders);
					if (baseURL) {
						ctx.baseURL = baseURL;
						ctx.options.baseURL = getOrigin(ctx.baseURL) || void 0;
					} else throw new BetterAuthError("Could not get base URL from request. Please provide a valid base URL.");
				}
				handlerCtx.trustedOrigins = await getTrustedOrigins(ctx.options, request);
			}
			handlerCtx.trustedProviders = await getTrustedProviders(handlerCtx.options, request);
			const { handler } = router(handlerCtx, options);
			return runWithAdapter(handlerCtx.adapter, () => handler(request));
		},
		api,
		options,
		$context: authContext,
		$ERROR_CODES: {
			...options.plugins?.reduce((acc, plugin) => {
				if (plugin.$ERROR_CODES) return {
					...acc,
					...plugin.$ERROR_CODES
				};
				return acc;
			}, {}),
			...BASE_ERROR_CODES
		}
	};
};
//#endregion
export { createBetterAuth };

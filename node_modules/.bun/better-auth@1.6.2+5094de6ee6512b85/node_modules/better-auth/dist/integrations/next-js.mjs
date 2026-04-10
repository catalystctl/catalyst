import { parseSetCookieHeader } from "../cookies/cookie-utils.mjs";
import { setShouldSkipSessionRefresh } from "../api/state/should-session-refresh.mjs";
import { PACKAGE_VERSION } from "../version.mjs";
import { createAuthMiddleware } from "@better-auth/core/api";
//#region src/integrations/next-js.ts
function toNextJsHandler(auth) {
	const handler = async (request) => {
		return "handler" in auth ? auth.handler(request) : auth(request);
	};
	return {
		GET: handler,
		POST: handler,
		PATCH: handler,
		PUT: handler,
		DELETE: handler
	};
}
const nextCookies = () => {
	return {
		id: "next-cookies",
		version: PACKAGE_VERSION,
		hooks: {
			before: [{
				matcher(ctx) {
					return ctx.path === "/get-session";
				},
				handler: createAuthMiddleware(async (ctx) => {
					if ("_flag" in ctx && ctx._flag === "router") return;
					let headersStore;
					try {
						const { headers } = await import("next/headers.js");
						headersStore = await headers();
					} catch {
						return;
					}
					/**
					* Detect RSC via headers, NOT by probing cookies().set().
					* In Next.js, cookies().set() unconditionally triggers router
					* cache invalidation -- even if the value is unchanged.
					*
					* RSC sends `RSC: 1` without `next-action`. Only in that
					* context cookies cannot be written -- skip session refresh
					* to avoid DB/cookie mismatch.
					*
					* @see https://github.com/vercel/next.js/blob/8c5af211d580/packages/next/src/server/web/spec-extension/adapters/request-cookies.ts#L112-L157
					*/
					const isRSC = headersStore.get("RSC") === "1";
					const isServerAction = !!headersStore.get("next-action");
					if (isRSC && !isServerAction) await setShouldSkipSessionRefresh(true);
				})
			}],
			after: [{
				matcher(ctx) {
					return true;
				},
				handler: createAuthMiddleware(async (ctx) => {
					const returned = ctx.context.responseHeaders;
					if ("_flag" in ctx && ctx._flag === "router") return;
					if (returned instanceof Headers) {
						const setCookies = returned?.get("set-cookie");
						if (!setCookies) return;
						const parsed = parseSetCookieHeader(setCookies);
						let cookieHelper;
						try {
							const { cookies } = await import("next/headers.js");
							cookieHelper = await cookies();
						} catch (error) {
							if (error instanceof Error && (error.message.startsWith("`cookies` was called outside a request scope.") || error.message.includes("Cannot find module"))) return;
							throw error;
						}
						parsed.forEach((value, key) => {
							if (!key) return;
							const opts = {
								sameSite: value.samesite,
								secure: value.secure,
								maxAge: value["max-age"],
								httpOnly: value.httponly,
								domain: value.domain,
								path: value.path
							};
							try {
								cookieHelper.set(key, value.value, opts);
							} catch {}
						});
						return;
					}
				})
			}]
		}
	};
};
//#endregion
export { nextCookies, toNextJsHandler };

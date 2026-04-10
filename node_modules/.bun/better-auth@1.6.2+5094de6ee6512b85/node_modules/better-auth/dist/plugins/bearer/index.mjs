import { parseSetCookieHeader } from "../../cookies/cookie-utils.mjs";
import { PACKAGE_VERSION } from "../../version.mjs";
import { serializeSignedCookie } from "better-call";
import { createAuthMiddleware } from "@better-auth/core/api";
import { createHMAC } from "@better-auth/utils/hmac";
//#region src/plugins/bearer/index.ts
const BEARER_SCHEME = "bearer ";
function tryDecode(str) {
	try {
		return decodeURIComponent(str);
	} catch {
		return str;
	}
}
/**
* Converts bearer token to session cookie
*/
const bearer = (options) => {
	return {
		id: "bearer",
		version: PACKAGE_VERSION,
		hooks: {
			before: [{
				matcher(context) {
					return Boolean(context.request?.headers.get("authorization") || context.headers?.get("authorization"));
				},
				handler: createAuthMiddleware(async (c) => {
					const authHeader = c.request?.headers.get("authorization") || c.headers?.get("Authorization");
					if (!authHeader) return;
					if (authHeader.slice(0, 7).toLowerCase() !== BEARER_SCHEME) return;
					const token = authHeader.slice(7).trim();
					if (!token) return;
					let signedToken;
					let decodedToken;
					if (token.includes(".")) {
						const isEncoded = token.includes("%");
						signedToken = isEncoded ? token : encodeURIComponent(token);
						decodedToken = isEncoded ? tryDecode(token) : token;
					} else {
						if (options?.requireSignature) return;
						signedToken = (await serializeSignedCookie("", token, c.context.secret)).replace("=", "");
						decodedToken = tryDecode(signedToken);
					}
					try {
						if (!await createHMAC("SHA-256", "base64urlnopad").verify(c.context.secret, decodedToken.split(".")[0], decodedToken.split(".")[1])) return;
					} catch {
						return;
					}
					const existingHeaders = c.request?.headers || c.headers;
					const headers = new Headers({ ...Object.fromEntries(existingHeaders?.entries()) });
					const existingCookie = headers.get("cookie");
					const newCookie = `${c.context.authCookies.sessionToken.name}=${signedToken}`;
					headers.set("cookie", existingCookie ? `${existingCookie}; ${newCookie}` : newCookie);
					return { context: { headers } };
				})
			}],
			after: [{
				matcher(context) {
					return true;
				},
				handler: createAuthMiddleware(async (ctx) => {
					const setCookie = ctx.context.responseHeaders?.get("set-cookie");
					if (!setCookie) return;
					const parsedCookies = parseSetCookieHeader(setCookie);
					const cookieName = ctx.context.authCookies.sessionToken.name;
					const sessionCookie = parsedCookies.get(cookieName);
					if (!sessionCookie || !sessionCookie.value || sessionCookie["max-age"] === 0) return;
					const token = sessionCookie.value;
					const exposedHeaders = ctx.context.responseHeaders?.get("access-control-expose-headers") || "";
					const headersSet = new Set(exposedHeaders.split(",").map((header) => header.trim()).filter(Boolean));
					headersSet.add("set-auth-token");
					ctx.setHeader("set-auth-token", token);
					ctx.setHeader("Access-Control-Expose-Headers", Array.from(headersSet).join(", "));
				})
			}]
		},
		options
	};
};
//#endregion
export { bearer };

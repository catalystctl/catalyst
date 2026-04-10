import { parseSessionOutput, parseUserOutput } from "../../db/schema.mjs";
import { SECURE_COOKIE_PREFIX, parseSetCookieHeader } from "../../cookies/cookie-utils.mjs";
import { deleteSessionCookie, expireCookie, parseCookies, setSessionCookie } from "../../cookies/index.mjs";
import { sessionMiddleware } from "../../api/routes/session.mjs";
import { APIError } from "../../api/index.mjs";
import { PACKAGE_VERSION } from "../../version.mjs";
import { MULTI_SESSION_ERROR_CODES } from "./error-codes.mjs";
import { createAuthEndpoint, createAuthMiddleware } from "@better-auth/core/api";
import * as z from "zod";
//#region src/plugins/multi-session/index.ts
const setActiveSessionBodySchema = z.object({ sessionToken: z.string().meta({ description: "The session token to set as active" }) });
const revokeDeviceSessionBodySchema = z.object({ sessionToken: z.string().meta({ description: "The session token to revoke" }) });
const multiSession = (options) => {
	const opts = {
		maximumSessions: 5,
		...options
	};
	const isMultiSessionCookie = (key) => key.includes("_multi-");
	return {
		id: "multi-session",
		version: PACKAGE_VERSION,
		endpoints: {
			listDeviceSessions: createAuthEndpoint("/multi-session/list-device-sessions", {
				method: "GET",
				requireHeaders: true
			}, async (ctx) => {
				const cookieHeader = ctx.headers?.get("cookie");
				if (!cookieHeader) return ctx.json([]);
				const cookies = Object.fromEntries(parseCookies(cookieHeader));
				const sessionTokens = (await Promise.all(Object.entries(cookies).filter(([key]) => isMultiSessionCookie(key)).map(async ([key]) => await ctx.getSignedCookie(key, ctx.context.secret)))).filter((v) => typeof v === "string");
				if (!sessionTokens.length) return ctx.json([]);
				const uniqueUserSessions = (await ctx.context.internalAdapter.findSessions(sessionTokens, { onlyActiveSessions: true })).filter((session) => session && session.session.expiresAt > /* @__PURE__ */ new Date()).reduce((acc, session) => {
					if (!acc.find((s) => s.user.id === session.user.id)) acc.push(session);
					return acc;
				}, []);
				return ctx.json(uniqueUserSessions.map((item) => ({
					session: parseSessionOutput(ctx.context.options, item.session),
					user: parseUserOutput(ctx.context.options, item.user)
				})));
			}),
			setActiveSession: createAuthEndpoint("/multi-session/set-active", {
				method: "POST",
				body: setActiveSessionBodySchema,
				requireHeaders: true,
				metadata: { openapi: {
					description: "Set the active session",
					responses: { 200: {
						description: "Success",
						content: { "application/json": { schema: {
							type: "object",
							properties: { session: { $ref: "#/components/schemas/Session" } }
						} } }
					} }
				} }
			}, async (ctx) => {
				const sessionToken = ctx.body.sessionToken;
				const multiSessionCookieName = `${ctx.context.authCookies.sessionToken.name}_multi-${sessionToken.toLowerCase()}`;
				if (!await ctx.getSignedCookie(multiSessionCookieName, ctx.context.secret)) throw APIError.from("UNAUTHORIZED", MULTI_SESSION_ERROR_CODES.INVALID_SESSION_TOKEN);
				const session = await ctx.context.internalAdapter.findSession(sessionToken);
				if (!session || session.session.expiresAt < /* @__PURE__ */ new Date()) {
					expireCookie(ctx, {
						name: multiSessionCookieName,
						attributes: ctx.context.authCookies.sessionToken.attributes
					});
					throw APIError.from("UNAUTHORIZED", MULTI_SESSION_ERROR_CODES.INVALID_SESSION_TOKEN);
				}
				await setSessionCookie(ctx, session);
				return ctx.json({
					session: parseSessionOutput(ctx.context.options, session.session),
					user: parseUserOutput(ctx.context.options, session.user)
				});
			}),
			revokeDeviceSession: createAuthEndpoint("/multi-session/revoke", {
				method: "POST",
				body: revokeDeviceSessionBodySchema,
				requireHeaders: true,
				use: [sessionMiddleware],
				metadata: { openapi: {
					description: "Revoke a device session",
					responses: { 200: {
						description: "Success",
						content: { "application/json": { schema: {
							type: "object",
							properties: { status: { type: "boolean" } }
						} } }
					} }
				} }
			}, async (ctx) => {
				const sessionToken = ctx.body.sessionToken;
				const multiSessionCookieName = `${ctx.context.authCookies.sessionToken.name}_multi-${sessionToken.toLowerCase()}`;
				if (!await ctx.getSignedCookie(multiSessionCookieName, ctx.context.secret)) throw APIError.from("UNAUTHORIZED", MULTI_SESSION_ERROR_CODES.INVALID_SESSION_TOKEN);
				await ctx.context.internalAdapter.deleteSession(sessionToken);
				expireCookie(ctx, {
					name: multiSessionCookieName,
					attributes: ctx.context.authCookies.sessionToken.attributes
				});
				if (!(ctx.context.session?.session.token === sessionToken)) return ctx.json({ status: true });
				const cookieHeader = ctx.headers?.get("cookie");
				if (cookieHeader) {
					const cookies = Object.fromEntries(parseCookies(cookieHeader));
					const sessionTokens = (await Promise.all(Object.entries(cookies).filter(([key]) => isMultiSessionCookie(key)).map(async ([key]) => await ctx.getSignedCookie(key, ctx.context.secret)))).filter((v) => typeof v === "string");
					const internalAdapter = ctx.context.internalAdapter;
					if (sessionTokens.length > 0) {
						const validSessions = (await internalAdapter.findSessions(sessionTokens)).filter((session) => session && session.session.expiresAt > /* @__PURE__ */ new Date());
						if (validSessions.length > 0) {
							const nextSession = validSessions[0];
							await setSessionCookie(ctx, nextSession);
						} else deleteSessionCookie(ctx);
					} else deleteSessionCookie(ctx);
				} else deleteSessionCookie(ctx);
				return ctx.json({ status: true });
			})
		},
		hooks: { after: [{
			matcher: () => true,
			handler: createAuthMiddleware(async (ctx) => {
				const cookieString = ctx.context.responseHeaders?.get("set-cookie");
				if (!cookieString) return;
				const newSession = ctx.context.newSession;
				if (!newSession) return;
				const sessionCookieConfig = ctx.context.authCookies.sessionToken;
				const sessionToken = newSession.session.token;
				const cookieName = `${sessionCookieConfig.name}_multi-${sessionToken.toLowerCase()}`;
				const setCookies = parseSetCookieHeader(cookieString);
				const cookies = parseCookies(ctx.headers?.get("cookie") || "");
				if (setCookies.get(cookieName) || cookies.get(cookieName)) return;
				const multiSessionKeys = Object.keys(Object.fromEntries(cookies)).filter(isMultiSessionCookie);
				const tokensToDelete = [];
				for (const key of multiSessionKeys) {
					const token = await ctx.getSignedCookie(key, ctx.context.secret);
					if (!token) continue;
					if ((await ctx.context.internalAdapter.findSession(token))?.user.id === newSession.user.id) {
						tokensToDelete.push(token);
						ctx.setCookie(key, "", {
							...sessionCookieConfig.attributes,
							maxAge: 0
						});
					}
				}
				if (tokensToDelete.length > 0) await ctx.context.internalAdapter.deleteSessions(tokensToDelete);
				if (multiSessionKeys.length - tokensToDelete.length + (cookieString.includes(sessionCookieConfig.name) ? 1 : 0) > opts.maximumSessions) return;
				await ctx.setSignedCookie(cookieName, sessionToken, ctx.context.secret, sessionCookieConfig.attributes);
			})
		}, {
			matcher: (context) => context.path === "/sign-out",
			handler: createAuthMiddleware(async (ctx) => {
				const cookieHeader = ctx.headers?.get("cookie");
				if (!cookieHeader) return;
				const cookies = Object.fromEntries(parseCookies(cookieHeader));
				const multiSessionKeys = Object.keys(cookies).filter((key) => isMultiSessionCookie(key));
				const verifiedTokens = (await Promise.all(multiSessionKeys.map(async (key) => {
					const verifiedToken = await ctx.getSignedCookie(key, ctx.context.secret);
					if (verifiedToken) {
						expireCookie(ctx, {
							name: key.toLowerCase().replace(SECURE_COOKIE_PREFIX.toLowerCase(), SECURE_COOKIE_PREFIX),
							attributes: ctx.context.authCookies.sessionToken.attributes
						});
						return verifiedToken;
					}
					return null;
				}))).filter((v) => typeof v === "string");
				if (verifiedTokens.length > 0) await ctx.context.internalAdapter.deleteSessions(verifiedTokens);
			})
		}] },
		options,
		$ERROR_CODES: MULTI_SESSION_ERROR_CODES
	};
};
//#endregion
export { MULTI_SESSION_ERROR_CODES as ERROR_CODES, multiSession };

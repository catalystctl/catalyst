import { mergeSchema, parseUserOutput } from "../../db/schema.mjs";
import { parseSetCookieHeader } from "../../cookies/cookie-utils.mjs";
import { deleteSessionCookie, setSessionCookie } from "../../cookies/index.mjs";
import { getSessionFromCtx, sensitiveSessionMiddleware } from "../../api/routes/session.mjs";
import { APIError } from "../../api/index.mjs";
import { PACKAGE_VERSION } from "../../version.mjs";
import { ANONYMOUS_ERROR_CODES } from "./error-codes.mjs";
import { schema } from "./schema.mjs";
import { generateId } from "@better-auth/core/utils/id";
import { createAuthEndpoint, createAuthMiddleware } from "@better-auth/core/api";
import * as z from "zod";
//#region src/plugins/anonymous/index.ts
async function getAnonUserEmail(options) {
	const customEmail = await options?.generateRandomEmail?.();
	if (customEmail) {
		if (!z.email().safeParse(customEmail).success) throw APIError.from("BAD_REQUEST", ANONYMOUS_ERROR_CODES.INVALID_EMAIL_FORMAT);
		return customEmail;
	}
	const id = generateId();
	if (options?.emailDomainName) return `temp-${id}@${options.emailDomainName}`;
	return `temp@${id}.com`;
}
const anonymous = (options) => {
	return {
		id: "anonymous",
		version: PACKAGE_VERSION,
		endpoints: {
			signInAnonymous: createAuthEndpoint("/sign-in/anonymous", {
				method: "POST",
				metadata: { openapi: {
					description: "Sign in anonymously",
					responses: { 200: {
						description: "Sign in anonymously",
						content: { "application/json": { schema: {
							type: "object",
							properties: {
								user: { $ref: "#/components/schemas/User" },
								session: { $ref: "#/components/schemas/Session" }
							}
						} } }
					} }
				} }
			}, async (ctx) => {
				if ((await getSessionFromCtx(ctx, { disableRefresh: true }))?.user.isAnonymous) throw APIError.from("BAD_REQUEST", ANONYMOUS_ERROR_CODES.ANONYMOUS_USERS_CANNOT_SIGN_IN_AGAIN_ANONYMOUSLY);
				const email = await getAnonUserEmail(options);
				const name = await options?.generateName?.(ctx) || "Anonymous";
				const newUser = await ctx.context.internalAdapter.createUser({
					email,
					emailVerified: false,
					isAnonymous: true,
					name,
					createdAt: /* @__PURE__ */ new Date(),
					updatedAt: /* @__PURE__ */ new Date()
				});
				if (!newUser) throw APIError.from("INTERNAL_SERVER_ERROR", ANONYMOUS_ERROR_CODES.FAILED_TO_CREATE_USER);
				const session = await ctx.context.internalAdapter.createSession(newUser.id);
				if (!session) throw APIError.from("BAD_REQUEST", ANONYMOUS_ERROR_CODES.COULD_NOT_CREATE_SESSION);
				await setSessionCookie(ctx, {
					session,
					user: newUser
				});
				return ctx.json({
					token: session.token,
					user: parseUserOutput(ctx.context.options, newUser)
				});
			}),
			deleteAnonymousUser: createAuthEndpoint("/delete-anonymous-user", {
				method: "POST",
				use: [sensitiveSessionMiddleware],
				metadata: { openapi: {
					description: "Delete an anonymous user",
					responses: {
						200: {
							description: "Anonymous user deleted",
							content: { "application/json": { schema: {
								type: "object",
								properties: { success: { type: "boolean" } }
							} } }
						},
						"400": {
							description: "Anonymous user deletion is disabled",
							content: { "application/json": {
								schema: {
									type: "object",
									properties: { message: { type: "string" } }
								},
								required: ["message"]
							} }
						},
						"500": {
							description: "Internal server error",
							content: { "application/json": { schema: {
								type: "object",
								properties: { message: { type: "string" } },
								required: ["message"]
							} } }
						}
					}
				} }
			}, async (ctx) => {
				const session = ctx.context.session;
				if (options?.disableDeleteAnonymousUser) throw APIError.from("BAD_REQUEST", ANONYMOUS_ERROR_CODES.DELETE_ANONYMOUS_USER_DISABLED);
				if (!session.user.isAnonymous) throw APIError.from("FORBIDDEN", ANONYMOUS_ERROR_CODES.USER_IS_NOT_ANONYMOUS);
				try {
					await ctx.context.internalAdapter.deleteUser(session.user.id);
				} catch (error) {
					ctx.context.logger.error("Failed to delete anonymous user", error);
					throw APIError.from("INTERNAL_SERVER_ERROR", ANONYMOUS_ERROR_CODES.FAILED_TO_DELETE_ANONYMOUS_USER);
				}
				deleteSessionCookie(ctx);
				return ctx.json({ success: true });
			})
		},
		hooks: { after: [{
			matcher(ctx) {
				return ctx.path?.startsWith("/sign-in") || ctx.path?.startsWith("/sign-up") || ctx.path?.startsWith("/callback") || ctx.path?.startsWith("/oauth2/callback") || ctx.path?.startsWith("/magic-link/verify") || ctx.path?.startsWith("/email-otp/verify-email") || ctx.path?.startsWith("/one-tap/callback") || ctx.path?.startsWith("/passkey/verify-authentication") || ctx.path?.startsWith("/phone-number/verify") || false;
			},
			handler: createAuthMiddleware(async (ctx) => {
				const setCookie = ctx.context.responseHeaders?.get("set-cookie");
				/**
				* We can consider the user is about to sign in or sign up
				* if the response contains a session token.
				*/
				const sessionTokenName = ctx.context.authCookies.sessionToken.name;
				if (!parseSetCookieHeader(setCookie || "").get(sessionTokenName)?.value.split(".")[0]) return;
				/**
				* Make sure the user had an anonymous session.
				*/
				const session = await getSessionFromCtx(ctx, { disableRefresh: true });
				if (!session || !session.user.isAnonymous) return;
				if (ctx.path === "/sign-in/anonymous" && !ctx.context.newSession) throw APIError.from("BAD_REQUEST", ANONYMOUS_ERROR_CODES.ANONYMOUS_USERS_CANNOT_SIGN_IN_AGAIN_ANONYMOUSLY);
				const newSession = ctx.context.newSession;
				if (!newSession) return;
				const user = {
					...session.user,
					isAnonymous: session.user.isAnonymous
				};
				if (options?.onLinkAccount) await options?.onLinkAccount?.({
					anonymousUser: {
						session: session.session,
						user
					},
					newUser: newSession,
					ctx
				});
				const newSessionUser = newSession.user;
				const isSameUser = newSessionUser?.id === session.user.id;
				const newSessionIsAnonymous = Boolean(newSessionUser?.isAnonymous);
				if (options?.disableDeleteAnonymousUser || isSameUser || newSessionIsAnonymous) return;
				await ctx.context.internalAdapter.deleteUser(session.user.id);
			})
		}] },
		options,
		schema: mergeSchema(schema, options?.schema),
		$ERROR_CODES: ANONYMOUS_ERROR_CODES
	};
};
//#endregion
export { anonymous };

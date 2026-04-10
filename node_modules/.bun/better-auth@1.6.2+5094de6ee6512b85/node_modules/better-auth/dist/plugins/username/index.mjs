import { mergeSchema, parseUserOutput } from "../../db/schema.mjs";
import { setSessionCookie } from "../../cookies/index.mjs";
import { getSessionFromCtx } from "../../api/routes/session.mjs";
import { createEmailVerificationToken } from "../../api/routes/email-verification.mjs";
import { PACKAGE_VERSION } from "../../version.mjs";
import { USERNAME_ERROR_CODES } from "./error-codes.mjs";
import { getSchema } from "./schema.mjs";
import { APIError, BASE_ERROR_CODES } from "@better-auth/core/error";
import { createAuthEndpoint, createAuthMiddleware } from "@better-auth/core/api";
import * as z from "zod";
//#region src/plugins/username/index.ts
function defaultUsernameValidator(username) {
	return /^[a-zA-Z0-9_.]+$/.test(username);
}
const signInUsernameBodySchema = z.object({
	username: z.string().meta({ description: "The username of the user" }),
	password: z.string().meta({ description: "The password of the user" }),
	rememberMe: z.boolean().meta({ description: "Remember the user session" }).optional(),
	callbackURL: z.string().meta({ description: "The URL to redirect to after email verification" }).optional()
});
const isUsernameAvailableBodySchema = z.object({ username: z.string().meta({ description: "The username to check" }) });
const username = (options) => {
	const normalizer = (username) => {
		if (options?.usernameNormalization === false) return username;
		if (options?.usernameNormalization) return options.usernameNormalization(username);
		return username.toLowerCase();
	};
	const displayUsernameNormalizer = (displayUsername) => {
		return options?.displayUsernameNormalization ? options.displayUsernameNormalization(displayUsername) : displayUsername;
	};
	return {
		id: "username",
		version: PACKAGE_VERSION,
		init(ctx) {
			return { options: { databaseHooks: { user: {
				create: { async before(user, context) {
					const username = "username" in user ? user.username : null;
					const displayUsername = "displayUsername" in user ? user.displayUsername : null;
					return { data: {
						...user,
						...username ? { username: normalizer(username) } : {},
						...displayUsername ? { displayUsername: displayUsernameNormalizer(displayUsername) } : {}
					} };
				} },
				update: { async before(user, context) {
					const username = "username" in user ? user.username : null;
					const displayUsername = "displayUsername" in user ? user.displayUsername : null;
					return { data: {
						...user,
						...username ? { username: normalizer(username) } : {},
						...displayUsername ? { displayUsername: displayUsernameNormalizer(displayUsername) } : {}
					} };
				} }
			} } } };
		},
		endpoints: {
			signInUsername: createAuthEndpoint("/sign-in/username", {
				method: "POST",
				body: signInUsernameBodySchema,
				metadata: { openapi: {
					summary: "Sign in with username",
					description: "Sign in with username",
					responses: {
						200: {
							description: "Success",
							content: { "application/json": { schema: {
								type: "object",
								properties: {
									token: {
										type: "string",
										description: "Session token for the authenticated session"
									},
									user: { $ref: "#/components/schemas/User" }
								},
								required: ["token", "user"]
							} } }
						},
						422: {
							description: "Unprocessable Entity. Validation error",
							content: { "application/json": { schema: {
								type: "object",
								properties: { message: { type: "string" } }
							} } }
						}
					}
				} }
			}, async (ctx) => {
				if (!ctx.body.username || !ctx.body.password) {
					ctx.context.logger.error("Username or password not found");
					throw APIError.from("UNAUTHORIZED", USERNAME_ERROR_CODES.INVALID_USERNAME_OR_PASSWORD);
				}
				const username = options?.validationOrder?.username === "pre-normalization" ? normalizer(ctx.body.username) : ctx.body.username;
				const minUsernameLength = options?.minUsernameLength || 3;
				const maxUsernameLength = options?.maxUsernameLength || 30;
				if (username.length < minUsernameLength) {
					ctx.context.logger.error("Username too short", { username });
					throw APIError.from("UNPROCESSABLE_ENTITY", USERNAME_ERROR_CODES.USERNAME_TOO_SHORT);
				}
				if (username.length > maxUsernameLength) {
					ctx.context.logger.error("Username too long", { username });
					throw APIError.from("UNPROCESSABLE_ENTITY", USERNAME_ERROR_CODES.USERNAME_TOO_LONG);
				}
				if (!await (options?.usernameValidator || defaultUsernameValidator)(username)) throw APIError.from("UNPROCESSABLE_ENTITY", USERNAME_ERROR_CODES.INVALID_USERNAME);
				const user = await ctx.context.adapter.findOne({
					model: "user",
					where: [{
						field: "username",
						value: normalizer(username)
					}]
				});
				if (!user) {
					await ctx.context.password.hash(ctx.body.password);
					ctx.context.logger.error("User not found", { username });
					throw APIError.from("UNAUTHORIZED", USERNAME_ERROR_CODES.INVALID_USERNAME_OR_PASSWORD);
				}
				const account = await ctx.context.adapter.findOne({
					model: "account",
					where: [{
						field: "userId",
						value: user.id
					}, {
						field: "providerId",
						value: "credential"
					}]
				});
				if (!account) throw APIError.from("UNAUTHORIZED", USERNAME_ERROR_CODES.INVALID_USERNAME_OR_PASSWORD);
				const currentPassword = account?.password;
				if (!currentPassword) {
					ctx.context.logger.error("Password not found", { username });
					throw APIError.from("UNAUTHORIZED", USERNAME_ERROR_CODES.INVALID_USERNAME_OR_PASSWORD);
				}
				if (!await ctx.context.password.verify({
					hash: currentPassword,
					password: ctx.body.password
				})) {
					ctx.context.logger.error("Invalid password");
					throw APIError.from("UNAUTHORIZED", USERNAME_ERROR_CODES.INVALID_USERNAME_OR_PASSWORD);
				}
				if (ctx.context.options?.emailAndPassword?.requireEmailVerification && !user.emailVerified) {
					if (!ctx.context.options?.emailVerification?.sendVerificationEmail) throw APIError.from("FORBIDDEN", USERNAME_ERROR_CODES.EMAIL_NOT_VERIFIED);
					if (ctx.context.options?.emailVerification?.sendOnSignIn) {
						const token = await createEmailVerificationToken(ctx.context.secret, user.email, void 0, ctx.context.options.emailVerification?.expiresIn);
						const url = `${ctx.context.baseURL}/verify-email?token=${token}&callbackURL=${ctx.body.callbackURL || "/"}`;
						await ctx.context.runInBackgroundOrAwait(ctx.context.options.emailVerification.sendVerificationEmail({
							user,
							url,
							token
						}, ctx.request));
					}
					throw APIError.from("FORBIDDEN", USERNAME_ERROR_CODES.EMAIL_NOT_VERIFIED);
				}
				const session = await ctx.context.internalAdapter.createSession(user.id, ctx.body.rememberMe === false);
				if (!session) throw APIError.from("INTERNAL_SERVER_ERROR", BASE_ERROR_CODES.FAILED_TO_CREATE_SESSION);
				await setSessionCookie(ctx, {
					session,
					user
				}, ctx.body.rememberMe === false);
				return ctx.json({
					token: session.token,
					user: parseUserOutput(ctx.context.options, user)
				});
			}),
			isUsernameAvailable: createAuthEndpoint("/is-username-available", {
				method: "POST",
				body: isUsernameAvailableBodySchema
			}, async (ctx) => {
				const username = ctx.body.username;
				if (!username) throw APIError.from("UNPROCESSABLE_ENTITY", USERNAME_ERROR_CODES.INVALID_USERNAME);
				const minUsernameLength = options?.minUsernameLength || 3;
				const maxUsernameLength = options?.maxUsernameLength || 30;
				if (username.length < minUsernameLength) throw APIError.from("UNPROCESSABLE_ENTITY", USERNAME_ERROR_CODES.USERNAME_TOO_SHORT);
				if (username.length > maxUsernameLength) throw APIError.from("UNPROCESSABLE_ENTITY", USERNAME_ERROR_CODES.USERNAME_TOO_LONG);
				if (!await (options?.usernameValidator || defaultUsernameValidator)(username)) throw APIError.from("UNPROCESSABLE_ENTITY", USERNAME_ERROR_CODES.INVALID_USERNAME);
				if (await ctx.context.adapter.findOne({
					model: "user",
					where: [{
						field: "username",
						value: normalizer(username)
					}]
				})) return ctx.json({ available: false });
				return ctx.json({ available: true });
			})
		},
		schema: mergeSchema(getSchema({
			username: normalizer,
			displayUsername: displayUsernameNormalizer
		}), options?.schema),
		hooks: { before: [{
			matcher(context) {
				return context.path === "/sign-up/email" || context.path === "/update-user";
			},
			handler: createAuthMiddleware(async (ctx) => {
				const username = typeof ctx.body.username === "string" && options?.validationOrder?.username === "post-normalization" ? normalizer(ctx.body.username) : ctx.body.username;
				if (username !== void 0 && typeof username === "string") {
					const minUsernameLength = options?.minUsernameLength || 3;
					const maxUsernameLength = options?.maxUsernameLength || 30;
					if (username.length < minUsernameLength) throw APIError.from("BAD_REQUEST", USERNAME_ERROR_CODES.USERNAME_TOO_SHORT);
					if (username.length > maxUsernameLength) throw APIError.from("BAD_REQUEST", USERNAME_ERROR_CODES.USERNAME_TOO_LONG);
					if (!await (options?.usernameValidator || defaultUsernameValidator)(username)) throw APIError.from("BAD_REQUEST", USERNAME_ERROR_CODES.INVALID_USERNAME);
					const normalizedUsername = normalizer(ctx.body.username);
					const existingUser = await ctx.context.adapter.findOne({
						model: "user",
						where: [{
							field: "username",
							value: normalizedUsername
						}]
					});
					if (ctx.path === "/sign-up/email" && existingUser) throw APIError.from("BAD_REQUEST", USERNAME_ERROR_CODES.USERNAME_IS_ALREADY_TAKEN);
					if (ctx.path === "/update-user" && existingUser) {
						const session = await getSessionFromCtx(ctx);
						if (!session || existingUser.id !== session.user.id) throw APIError.from("BAD_REQUEST", USERNAME_ERROR_CODES.USERNAME_IS_ALREADY_TAKEN);
					}
				}
				const displayUsername = typeof ctx.body.displayUsername === "string" && options?.validationOrder?.displayUsername === "post-normalization" ? displayUsernameNormalizer(ctx.body.displayUsername) : ctx.body.displayUsername;
				if (displayUsername !== void 0 && typeof displayUsername === "string") {
					if (options?.displayUsernameValidator) {
						if (!await options.displayUsernameValidator(displayUsername)) throw APIError.from("BAD_REQUEST", USERNAME_ERROR_CODES.INVALID_DISPLAY_USERNAME);
					}
				}
			})
		}, {
			matcher(context) {
				return context.path === "/sign-up/email";
			},
			handler: createAuthMiddleware(async (ctx) => {
				if (ctx.body.username && !ctx.body.displayUsername) ctx.body.displayUsername = ctx.body.username;
				if (ctx.body.displayUsername && !ctx.body.username) ctx.body.username = ctx.body.displayUsername;
			})
		}] },
		options,
		$ERROR_CODES: USERNAME_ERROR_CODES
	};
};
//#endregion
export { USERNAME_ERROR_CODES, username };

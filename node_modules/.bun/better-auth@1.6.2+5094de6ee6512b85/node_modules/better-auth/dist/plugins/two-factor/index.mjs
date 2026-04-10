import { mergeSchema } from "../../db/schema.mjs";
import { generateRandomString } from "../../crypto/random.mjs";
import { symmetricEncrypt } from "../../crypto/index.mjs";
import { deleteSessionCookie, expireCookie, setSessionCookie } from "../../cookies/index.mjs";
import { sessionMiddleware } from "../../api/routes/session.mjs";
import { shouldRequirePassword, validatePassword } from "../../utils/password.mjs";
import { PACKAGE_VERSION } from "../../version.mjs";
import { TWO_FACTOR_ERROR_CODES } from "./error-code.mjs";
import { twoFactorClient } from "./client.mjs";
import { TRUST_DEVICE_COOKIE_NAME, TWO_FACTOR_COOKIE_NAME } from "./constant.mjs";
import { backupCode2fa, generateBackupCodes } from "./backup-codes/index.mjs";
import { otp2fa } from "./otp/index.mjs";
import { schema } from "./schema.mjs";
import { totp2fa } from "./totp/index.mjs";
import { APIError, BASE_ERROR_CODES } from "@better-auth/core/error";
import { createAuthEndpoint, createAuthMiddleware } from "@better-auth/core/api";
import * as z from "zod";
import { createHMAC } from "@better-auth/utils/hmac";
import { createOTP } from "@better-auth/utils/otp";
//#region src/plugins/two-factor/index.ts
const twoFactor = (options) => {
	const opts = { twoFactorTable: "twoFactor" };
	const trustDeviceMaxAge = options?.trustDeviceMaxAge ?? 2592e3;
	const allowPasswordless = options?.allowPasswordless;
	const backupCodeOptions = {
		storeBackupCodes: "encrypted",
		...options?.backupCodeOptions
	};
	const totp = totp2fa({
		...options?.totpOptions,
		allowPasswordless: options?.totpOptions?.allowPasswordless ?? allowPasswordless
	});
	const backupCode = backupCode2fa({
		...backupCodeOptions,
		allowPasswordless: options?.backupCodeOptions?.allowPasswordless ?? allowPasswordless
	});
	const otp = otp2fa(options?.otpOptions);
	const passwordSchema = z.string().meta({ description: "User password" });
	const enableTwoFactorBodySchema = allowPasswordless ? z.object({
		password: passwordSchema.optional(),
		issuer: z.string().meta({ description: "Custom issuer for the TOTP URI" }).optional()
	}) : z.object({
		password: passwordSchema,
		issuer: z.string().meta({ description: "Custom issuer for the TOTP URI" }).optional()
	});
	const disableTwoFactorBodySchema = allowPasswordless ? z.object({ password: passwordSchema.optional() }) : z.object({ password: passwordSchema });
	return {
		id: "two-factor",
		version: PACKAGE_VERSION,
		endpoints: {
			...totp.endpoints,
			...otp.endpoints,
			...backupCode.endpoints,
			enableTwoFactor: createAuthEndpoint("/two-factor/enable", {
				method: "POST",
				body: enableTwoFactorBodySchema,
				use: [sessionMiddleware],
				metadata: { openapi: {
					summary: "Enable two factor authentication",
					description: "Use this endpoint to enable two factor authentication. This will generate a TOTP URI and backup codes. Once the user verifies the TOTP URI, the two factor authentication will be enabled.",
					responses: { 200: {
						description: "Successful response",
						content: { "application/json": { schema: {
							type: "object",
							properties: {
								totpURI: {
									type: "string",
									description: "TOTP URI"
								},
								backupCodes: {
									type: "array",
									items: { type: "string" },
									description: "Backup codes"
								}
							}
						} } }
					} }
				} }
			}, async (ctx) => {
				const user = ctx.context.session.user;
				const { password, issuer } = ctx.body;
				if (await shouldRequirePassword(ctx, user.id, allowPasswordless)) {
					if (!password) throw APIError.from("BAD_REQUEST", BASE_ERROR_CODES.INVALID_PASSWORD);
					if (!await validatePassword(ctx, {
						password,
						userId: user.id
					})) throw APIError.from("BAD_REQUEST", BASE_ERROR_CODES.INVALID_PASSWORD);
				}
				const secret = generateRandomString(32);
				const encryptedSecret = await symmetricEncrypt({
					key: ctx.context.secretConfig,
					data: secret
				});
				const backupCodes = await generateBackupCodes(ctx.context.secretConfig, backupCodeOptions);
				if (options?.skipVerificationOnEnable) {
					const updatedUser = await ctx.context.internalAdapter.updateUser(user.id, { twoFactorEnabled: true });
					/**
					* Update the session cookie with the new user data
					*/
					await setSessionCookie(ctx, {
						session: await ctx.context.internalAdapter.createSession(updatedUser.id, false, ctx.context.session.session),
						user: updatedUser
					});
					await ctx.context.internalAdapter.deleteSession(ctx.context.session.session.token);
				}
				const existingTwoFactor = await ctx.context.adapter.findOne({
					model: opts.twoFactorTable,
					where: [{
						field: "userId",
						value: user.id
					}]
				});
				await ctx.context.adapter.deleteMany({
					model: opts.twoFactorTable,
					where: [{
						field: "userId",
						value: user.id
					}]
				});
				await ctx.context.adapter.create({
					model: opts.twoFactorTable,
					data: {
						secret: encryptedSecret,
						backupCodes: backupCodes.encryptedBackupCodes,
						userId: user.id,
						verified: existingTwoFactor != null && existingTwoFactor.verified !== false || !!options?.skipVerificationOnEnable
					}
				});
				const totpURI = createOTP(secret, {
					digits: options?.totpOptions?.digits || 6,
					period: options?.totpOptions?.period
				}).url(issuer || options?.issuer || ctx.context.appName, user.email);
				return ctx.json({
					totpURI,
					backupCodes: backupCodes.backupCodes
				});
			}),
			disableTwoFactor: createAuthEndpoint("/two-factor/disable", {
				method: "POST",
				body: disableTwoFactorBodySchema,
				use: [sessionMiddleware],
				metadata: { openapi: {
					summary: "Disable two factor authentication",
					description: "Use this endpoint to disable two factor authentication.",
					responses: { 200: {
						description: "Successful response",
						content: { "application/json": { schema: {
							type: "object",
							properties: { status: { type: "boolean" } }
						} } }
					} }
				} }
			}, async (ctx) => {
				const user = ctx.context.session.user;
				const { password } = ctx.body;
				if (await shouldRequirePassword(ctx, user.id, allowPasswordless)) {
					if (!password) throw APIError.from("BAD_REQUEST", BASE_ERROR_CODES.INVALID_PASSWORD);
					if (!await validatePassword(ctx, {
						password,
						userId: user.id
					})) throw APIError.from("BAD_REQUEST", BASE_ERROR_CODES.INVALID_PASSWORD);
				}
				const updatedUser = await ctx.context.internalAdapter.updateUser(user.id, { twoFactorEnabled: false });
				await ctx.context.adapter.delete({
					model: opts.twoFactorTable,
					where: [{
						field: "userId",
						value: updatedUser.id
					}]
				});
				/**
				* Update the session cookie with the new user data
				*/
				await setSessionCookie(ctx, {
					session: await ctx.context.internalAdapter.createSession(updatedUser.id, false, ctx.context.session.session),
					user: updatedUser
				});
				await ctx.context.internalAdapter.deleteSession(ctx.context.session.session.token);
				const disableTrustCookie = ctx.context.createAuthCookie(TRUST_DEVICE_COOKIE_NAME, { maxAge: trustDeviceMaxAge });
				const disableTrustValue = await ctx.getSignedCookie(disableTrustCookie.name, ctx.context.secret);
				if (disableTrustValue) {
					const [, trustId] = disableTrustValue.split("!");
					if (trustId) await ctx.context.internalAdapter.deleteVerificationByIdentifier(trustId);
					expireCookie(ctx, disableTrustCookie);
				}
				return ctx.json({ status: true });
			})
		},
		options,
		hooks: { after: [{
			matcher(context) {
				return context.path === "/sign-in/email" || context.path === "/sign-in/username" || context.path === "/sign-in/phone-number";
			},
			handler: createAuthMiddleware(async (ctx) => {
				const data = ctx.context.newSession;
				if (!data) return;
				if (!data?.user.twoFactorEnabled) return;
				const trustDeviceCookieAttrs = ctx.context.createAuthCookie(TRUST_DEVICE_COOKIE_NAME, { maxAge: trustDeviceMaxAge });
				const trustDeviceCookie = await ctx.getSignedCookie(trustDeviceCookieAttrs.name, ctx.context.secret);
				if (trustDeviceCookie) {
					const [token, trustIdentifier] = trustDeviceCookie.split("!");
					if (token && trustIdentifier) {
						if (token === await createHMAC("SHA-256", "base64urlnopad").sign(ctx.context.secret, `${data.user.id}!${trustIdentifier}`)) {
							const verificationRecord = await ctx.context.internalAdapter.findVerificationValue(trustIdentifier);
							if (verificationRecord && verificationRecord.value === data.user.id && verificationRecord.expiresAt > /* @__PURE__ */ new Date()) {
								await ctx.context.internalAdapter.deleteVerificationByIdentifier(trustIdentifier);
								const newTrustIdentifier = `trust-device-${generateRandomString(32)}`;
								const newToken = await createHMAC("SHA-256", "base64urlnopad").sign(ctx.context.secret, `${data.user.id}!${newTrustIdentifier}`);
								await ctx.context.internalAdapter.createVerificationValue({
									value: data.user.id,
									identifier: newTrustIdentifier,
									expiresAt: new Date(Date.now() + trustDeviceMaxAge * 1e3)
								});
								const newTrustDeviceCookie = ctx.context.createAuthCookie(TRUST_DEVICE_COOKIE_NAME, { maxAge: trustDeviceMaxAge });
								await ctx.setSignedCookie(newTrustDeviceCookie.name, `${newToken}!${newTrustIdentifier}`, ctx.context.secret, trustDeviceCookieAttrs.attributes);
								return;
							}
						}
					}
					expireCookie(ctx, trustDeviceCookieAttrs);
				}
				/**
				* remove the session cookie. It's set by the sign in credential
				*/
				deleteSessionCookie(ctx, true);
				await ctx.context.internalAdapter.deleteSession(data.session.token);
				const maxAge = options?.twoFactorCookieMaxAge ?? 600;
				const twoFactorCookie = ctx.context.createAuthCookie(TWO_FACTOR_COOKIE_NAME, { maxAge });
				const identifier = `2fa-${generateRandomString(20)}`;
				await ctx.context.internalAdapter.createVerificationValue({
					value: data.user.id,
					identifier,
					expiresAt: new Date(Date.now() + maxAge * 1e3)
				});
				await ctx.setSignedCookie(twoFactorCookie.name, identifier, ctx.context.secret, twoFactorCookie.attributes);
				const twoFactorMethods = [];
				/**
				* totp requires per-user setup, so we check
				* that the user actually has a secret stored.
				*/
				if (!options?.totpOptions?.disable) {
					const userTotpSecret = await ctx.context.adapter.findOne({
						model: opts.twoFactorTable,
						where: [{
							field: "userId",
							value: data.user.id
						}]
					});
					if (userTotpSecret && userTotpSecret.verified !== false) twoFactorMethods.push("totp");
				}
				/**
				* otp is server-level — if sendOTP is configured,
				* any user with 2fa enabled can receive a code.
				*/
				if (options?.otpOptions?.sendOTP) twoFactorMethods.push("otp");
				return ctx.json({
					twoFactorRedirect: true,
					twoFactorMethods
				});
			})
		}] },
		schema: mergeSchema(schema, {
			...options?.schema,
			twoFactor: {
				...options?.schema?.twoFactor,
				...options?.twoFactorTable ? { modelName: options.twoFactorTable } : {}
			}
		}),
		rateLimit: [{
			pathMatcher(path) {
				return path.startsWith("/two-factor/");
			},
			window: 10,
			max: 3
		}],
		$ERROR_CODES: TWO_FACTOR_ERROR_CODES
	};
};
//#endregion
export { TWO_FACTOR_ERROR_CODES, twoFactor, twoFactorClient };

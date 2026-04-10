import { symmetricDecrypt } from "../../../crypto/index.mjs";
import { setSessionCookie } from "../../../cookies/index.mjs";
import { sessionMiddleware } from "../../../api/routes/session.mjs";
import { shouldRequirePassword } from "../../../utils/password.mjs";
import { PACKAGE_VERSION } from "../../../version.mjs";
import { TWO_FACTOR_ERROR_CODES } from "../error-code.mjs";
import { verifyTwoFactor } from "../verify-two-factor.mjs";
import { APIError, BASE_ERROR_CODES } from "@better-auth/core/error";
import { createAuthEndpoint } from "@better-auth/core/api";
import * as z from "zod";
import { createOTP } from "@better-auth/utils/otp";
//#region src/plugins/two-factor/totp/index.ts
const generateTOTPBodySchema = z.object({ secret: z.string().meta({ description: "The secret to generate the TOTP code" }) });
const verifyTOTPBodySchema = z.object({
	code: z.string().meta({ description: "The otp code to verify. Eg: \"012345\"" }),
	trustDevice: z.boolean().meta({ description: "If true, the device will be trusted for 30 days. It'll be refreshed on every sign in request within this time. Eg: true" }).optional()
});
const totp2fa = (options) => {
	const opts = {
		...options,
		digits: options?.digits || 6,
		period: options?.period || 30
	};
	const passwordSchema = z.string().meta({ description: "User password" });
	const getTOTPURIBodySchema = options?.allowPasswordless ? z.object({ password: passwordSchema.optional() }) : z.object({ password: passwordSchema });
	const twoFactorTable = "twoFactor";
	return {
		id: "totp",
		version: PACKAGE_VERSION,
		endpoints: {
			generateTOTP: createAuthEndpoint({
				method: "POST",
				body: generateTOTPBodySchema,
				metadata: { openapi: {
					summary: "Generate TOTP code",
					description: "Use this endpoint to generate a TOTP code",
					responses: { 200: {
						description: "Successful response",
						content: { "application/json": { schema: {
							type: "object",
							properties: { code: { type: "string" } }
						} } }
					} }
				} }
			}, async (ctx) => {
				if (options?.disable) {
					ctx.context.logger.error("totp isn't configured. please pass totp option on two factor plugin to enable totp");
					throw APIError.from("BAD_REQUEST", {
						message: "totp isn't configured",
						code: "TOTP_NOT_CONFIGURED"
					});
				}
				return { code: await createOTP(ctx.body.secret, {
					period: opts.period,
					digits: opts.digits
				}).totp() };
			}),
			getTOTPURI: createAuthEndpoint("/two-factor/get-totp-uri", {
				method: "POST",
				use: [sessionMiddleware],
				body: getTOTPURIBodySchema,
				metadata: { openapi: {
					summary: "Get TOTP URI",
					description: "Use this endpoint to get the TOTP URI",
					responses: { 200: {
						description: "Successful response",
						content: { "application/json": { schema: {
							type: "object",
							properties: { totpURI: { type: "string" } }
						} } }
					} }
				} }
			}, async (ctx) => {
				if (options?.disable) {
					ctx.context.logger.error("totp isn't configured. please pass totp option on two factor plugin to enable totp");
					throw APIError.from("BAD_REQUEST", {
						message: "totp isn't configured",
						code: "TOTP_NOT_CONFIGURED"
					});
				}
				const user = ctx.context.session.user;
				const twoFactor = await ctx.context.adapter.findOne({
					model: twoFactorTable,
					where: [{
						field: "userId",
						value: user.id
					}]
				});
				if (!twoFactor) throw APIError.from("BAD_REQUEST", TWO_FACTOR_ERROR_CODES.TOTP_NOT_ENABLED);
				const secret = await symmetricDecrypt({
					key: ctx.context.secretConfig,
					data: twoFactor.secret
				});
				if (await shouldRequirePassword(ctx, user.id, options?.allowPasswordless)) {
					if (!ctx.body.password) throw APIError.from("BAD_REQUEST", BASE_ERROR_CODES.INVALID_PASSWORD);
					await ctx.context.password.checkPassword(user.id, ctx);
				}
				return { totpURI: createOTP(secret, {
					digits: opts.digits,
					period: opts.period
				}).url(options?.issuer || ctx.context.appName, user.email) };
			}),
			verifyTOTP: createAuthEndpoint("/two-factor/verify-totp", {
				method: "POST",
				body: verifyTOTPBodySchema,
				metadata: { openapi: {
					summary: "Verify two factor TOTP",
					description: "Verify two factor TOTP",
					responses: { 200: {
						description: "Successful response",
						content: { "application/json": { schema: {
							type: "object",
							properties: { status: { type: "boolean" } }
						} } }
					} }
				} }
			}, async (ctx) => {
				if (options?.disable) {
					ctx.context.logger.error("totp isn't configured. please pass totp option on two factor plugin to enable totp");
					throw APIError.from("BAD_REQUEST", {
						message: "totp isn't configured",
						code: "TOTP_NOT_CONFIGURED"
					});
				}
				const { session, valid, invalid } = await verifyTwoFactor(ctx);
				const user = session.user;
				const isSignIn = !session.session;
				const twoFactor = await ctx.context.adapter.findOne({
					model: twoFactorTable,
					where: [{
						field: "userId",
						value: user.id
					}]
				});
				if (!twoFactor) throw APIError.from("BAD_REQUEST", TWO_FACTOR_ERROR_CODES.TOTP_NOT_ENABLED);
				if (isSignIn && twoFactor.verified === false) throw APIError.from("BAD_REQUEST", TWO_FACTOR_ERROR_CODES.TOTP_NOT_ENABLED);
				if (!await createOTP(await symmetricDecrypt({
					key: ctx.context.secretConfig,
					data: twoFactor.secret
				}), {
					period: opts.period,
					digits: opts.digits
				}).verify(ctx.body.code)) return invalid("INVALID_CODE");
				if (twoFactor.verified !== true) {
					if (!user.twoFactorEnabled) {
						const activeSession = session.session;
						const updatedUser = await ctx.context.internalAdapter.updateUser(user.id, { twoFactorEnabled: true });
						await setSessionCookie(ctx, {
							session: await ctx.context.internalAdapter.createSession(user.id, false, activeSession),
							user: updatedUser
						});
						await ctx.context.internalAdapter.deleteSession(activeSession.token);
					}
					await ctx.context.adapter.update({
						model: twoFactorTable,
						update: { verified: true },
						where: [{
							field: "id",
							value: twoFactor.id
						}]
					});
				}
				return valid(ctx);
			})
		}
	};
};
//#endregion
export { totp2fa };

import { parseUserOutput } from "../../db/schema.mjs";
import { generateRandomString } from "../../crypto/random.mjs";
import { expireCookie, setSessionCookie } from "../../cookies/index.mjs";
import { getSessionFromCtx } from "../../api/routes/session.mjs";
import { TWO_FACTOR_ERROR_CODES } from "./error-code.mjs";
import { TRUST_DEVICE_COOKIE_NAME, TWO_FACTOR_COOKIE_NAME } from "./constant.mjs";
import { APIError } from "@better-auth/core/error";
import { createHMAC } from "@better-auth/utils/hmac";
//#region src/plugins/two-factor/verify-two-factor.ts
async function verifyTwoFactor(ctx) {
	const invalid = (errorKey) => {
		throw APIError.from("UNAUTHORIZED", TWO_FACTOR_ERROR_CODES[errorKey]);
	};
	const session = await getSessionFromCtx(ctx);
	if (!session) {
		const twoFactorCookie = ctx.context.createAuthCookie(TWO_FACTOR_COOKIE_NAME);
		const signedTwoFactorCookie = await ctx.getSignedCookie(twoFactorCookie.name, ctx.context.secret);
		if (!signedTwoFactorCookie) throw APIError.from("UNAUTHORIZED", TWO_FACTOR_ERROR_CODES.INVALID_TWO_FACTOR_COOKIE);
		const verificationToken = await ctx.context.internalAdapter.findVerificationValue(signedTwoFactorCookie);
		if (!verificationToken) throw APIError.from("UNAUTHORIZED", TWO_FACTOR_ERROR_CODES.INVALID_TWO_FACTOR_COOKIE);
		const user = await ctx.context.internalAdapter.findUserById(verificationToken.value);
		if (!user) throw APIError.from("UNAUTHORIZED", TWO_FACTOR_ERROR_CODES.INVALID_TWO_FACTOR_COOKIE);
		const dontRememberMe = await ctx.getSignedCookie(ctx.context.authCookies.dontRememberToken.name, ctx.context.secret);
		return {
			valid: async (ctx) => {
				const session = await ctx.context.internalAdapter.createSession(verificationToken.value, !!dontRememberMe);
				if (!session) throw APIError.from("INTERNAL_SERVER_ERROR", {
					message: "failed to create session",
					code: "FAILED_TO_CREATE_SESSION"
				});
				await ctx.context.internalAdapter.deleteVerificationByIdentifier(signedTwoFactorCookie);
				await setSessionCookie(ctx, {
					session,
					user
				});
				expireCookie(ctx, twoFactorCookie);
				if (ctx.body.trustDevice) {
					const maxAge = ctx.context.getPlugin("two-factor").options?.trustDeviceMaxAge ?? 2592e3;
					const trustDeviceCookie = ctx.context.createAuthCookie(TRUST_DEVICE_COOKIE_NAME, { maxAge });
					/**
					* Create a random identifier for the trust device record.
					* Store it in the verification table with an expiration
					* so the server can validate and revoke it.
					*/
					const trustIdentifier = `trust-device-${generateRandomString(32)}`;
					const token = await createHMAC("SHA-256", "base64urlnopad").sign(ctx.context.secret, `${user.id}!${trustIdentifier}`);
					await ctx.context.internalAdapter.createVerificationValue({
						value: user.id,
						identifier: trustIdentifier,
						expiresAt: new Date(Date.now() + maxAge * 1e3)
					});
					await ctx.setSignedCookie(trustDeviceCookie.name, `${token}!${trustIdentifier}`, ctx.context.secret, trustDeviceCookie.attributes);
					expireCookie(ctx, ctx.context.authCookies.dontRememberToken);
				}
				return ctx.json({
					token: session.token,
					user: parseUserOutput(ctx.context.options, user)
				});
			},
			invalid,
			session: {
				session: null,
				user
			},
			key: signedTwoFactorCookie
		};
	}
	return {
		valid: async (ctx) => {
			return ctx.json({
				token: session.session.token,
				user: parseUserOutput(ctx.context.options, session.user)
			});
		},
		invalid,
		session,
		key: `${session.user.id}!${session.session.id}`
	};
}
//#endregion
export { verifyTwoFactor };

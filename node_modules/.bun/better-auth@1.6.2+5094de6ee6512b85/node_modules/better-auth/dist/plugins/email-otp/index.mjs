import { getDate } from "../../utils/date.mjs";
import { generateRandomString } from "../../crypto/random.mjs";
import { PACKAGE_VERSION } from "../../version.mjs";
import { EMAIL_OTP_ERROR_CODES } from "./error-codes.mjs";
import { getEndpointResponse } from "../../utils/plugin-helper.mjs";
import { toOTPIdentifier } from "./utils.mjs";
import { storeOTP } from "./otp-token.mjs";
import { changeEmailEmailOTP, checkVerificationOTP, createVerificationOTP, forgetPasswordEmailOTP, getVerificationOTP, requestEmailChangeEmailOTP, requestPasswordResetEmailOTP, resetPasswordEmailOTP, sendVerificationOTP, signInEmailOTP, verifyEmailOTP } from "./routes.mjs";
import { createAuthMiddleware } from "@better-auth/core/api";
//#region src/plugins/email-otp/index.ts
const defaultOTPGenerator = (options) => generateRandomString(options.otpLength ?? 6, "0-9");
const emailOTP = (options) => {
	const opts = {
		expiresIn: 300,
		generateOTP: () => defaultOTPGenerator(options),
		storeOTP: "plain",
		...options
	};
	const sendVerificationOTPAction = sendVerificationOTP(opts);
	return {
		id: "email-otp",
		version: PACKAGE_VERSION,
		init(ctx) {
			if (!opts.overrideDefaultEmailVerification) return;
			return { options: { emailVerification: { async sendVerificationEmail(data, request) {
				await ctx.runInBackgroundOrAwait(sendVerificationOTPAction({
					context: ctx,
					request,
					body: {
						email: data.user.email,
						type: "email-verification"
					},
					ctx
				}));
			} } } };
		},
		endpoints: {
			sendVerificationOTP: sendVerificationOTPAction,
			createVerificationOTP: createVerificationOTP(opts),
			getVerificationOTP: getVerificationOTP(opts),
			checkVerificationOTP: checkVerificationOTP(opts),
			verifyEmailOTP: verifyEmailOTP(opts),
			signInEmailOTP: signInEmailOTP(opts),
			requestPasswordResetEmailOTP: requestPasswordResetEmailOTP(opts),
			forgetPasswordEmailOTP: forgetPasswordEmailOTP(opts),
			resetPasswordEmailOTP: resetPasswordEmailOTP(opts),
			requestEmailChangeEmailOTP: requestEmailChangeEmailOTP(opts),
			changeEmailEmailOTP: changeEmailEmailOTP(opts)
		},
		hooks: { after: [{
			matcher(context) {
				return !!(context.path?.startsWith("/sign-up") && opts.sendVerificationOnSignUp && !opts.overrideDefaultEmailVerification);
			},
			handler: createAuthMiddleware(async (ctx) => {
				const email = (await getEndpointResponse(ctx))?.user.email;
				if (email) {
					const otp = opts.generateOTP({
						email,
						type: ctx.body.type
					}, ctx) || defaultOTPGenerator(opts);
					const storedOTP = await storeOTP(ctx, opts, otp);
					await ctx.context.internalAdapter.createVerificationValue({
						value: `${storedOTP}:0`,
						identifier: toOTPIdentifier("email-verification", email),
						expiresAt: getDate(opts.expiresIn, "sec")
					});
					await ctx.context.runInBackgroundOrAwait(options.sendVerificationOTP({
						email,
						otp,
						type: "email-verification"
					}, ctx));
				}
			})
		}] },
		rateLimit: [
			{
				pathMatcher(path) {
					return path === "/email-otp/send-verification-otp";
				},
				window: opts.rateLimit?.window || 60,
				max: opts.rateLimit?.max || 3
			},
			{
				pathMatcher(path) {
					return path === "/email-otp/check-verification-otp";
				},
				window: opts.rateLimit?.window || 60,
				max: opts.rateLimit?.max || 3
			},
			{
				pathMatcher(path) {
					return path === "/email-otp/verify-email";
				},
				window: opts.rateLimit?.window || 60,
				max: opts.rateLimit?.max || 3
			},
			{
				pathMatcher(path) {
					return path === "/sign-in/email-otp";
				},
				window: opts.rateLimit?.window || 60,
				max: opts.rateLimit?.max || 3
			},
			{
				pathMatcher(path) {
					return path === "/email-otp/request-password-reset";
				},
				window: opts.rateLimit?.window || 60,
				max: opts.rateLimit?.max || 3
			},
			{
				pathMatcher(path) {
					return path === "/email-otp/reset-password";
				},
				window: opts.rateLimit?.window || 60,
				max: opts.rateLimit?.max || 3
			},
			{
				pathMatcher(path) {
					return path === "/forget-password/email-otp";
				},
				window: opts.rateLimit?.window || 60,
				max: opts.rateLimit?.max || 3
			},
			{
				pathMatcher(path) {
					return path === "/email-otp/request-email-change";
				},
				window: opts.rateLimit?.window || 60,
				max: opts.rateLimit?.max || 3
			},
			{
				pathMatcher(path) {
					return path === "/email-otp/change-email";
				},
				window: opts.rateLimit?.window || 60,
				max: opts.rateLimit?.max || 3
			}
		],
		options,
		$ERROR_CODES: EMAIL_OTP_ERROR_CODES
	};
};
//#endregion
export { emailOTP };

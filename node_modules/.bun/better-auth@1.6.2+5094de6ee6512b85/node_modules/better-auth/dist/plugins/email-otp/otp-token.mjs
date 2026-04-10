import { getDate } from "../../utils/date.mjs";
import { constantTimeEqual } from "../../crypto/buffer.mjs";
import { symmetricDecrypt, symmetricEncrypt } from "../../crypto/index.mjs";
import { defaultKeyHasher, splitAtLastColon } from "./utils.mjs";
//#region src/plugins/email-otp/otp-token.ts
async function storeOTP(ctx, opts, otp) {
	if (opts.storeOTP === "encrypted") return await symmetricEncrypt({
		key: ctx.context.secretConfig,
		data: otp
	});
	if (opts.storeOTP === "hashed") return await defaultKeyHasher(otp);
	if (typeof opts.storeOTP === "object" && "hash" in opts.storeOTP) return await opts.storeOTP.hash(otp);
	if (typeof opts.storeOTP === "object" && "encrypt" in opts.storeOTP) return await opts.storeOTP.encrypt(otp);
	return otp;
}
async function verifyStoredOTP(ctx, opts, storedOtp, otp) {
	if (opts.storeOTP === "encrypted") return constantTimeEqual(await symmetricDecrypt({
		key: ctx.context.secretConfig,
		data: storedOtp
	}), otp);
	if (opts.storeOTP === "hashed") return constantTimeEqual(await defaultKeyHasher(otp), storedOtp);
	if (typeof opts.storeOTP === "object" && "hash" in opts.storeOTP) return constantTimeEqual(await opts.storeOTP.hash(otp), storedOtp);
	if (typeof opts.storeOTP === "object" && "decrypt" in opts.storeOTP) return constantTimeEqual(await opts.storeOTP.decrypt(storedOtp), otp);
	return constantTimeEqual(otp, storedOtp);
}
/**
* Retrieves the plain-text OTP from a stored value.
* Returns `null` if the OTP is hashed and cannot be recovered.
*/
async function retrieveOTP(ctx, opts, storedOtp) {
	if (opts.storeOTP === "plain" || opts.storeOTP === void 0) return storedOtp;
	if (opts.storeOTP === "encrypted") return await symmetricDecrypt({
		key: ctx.context.secretConfig,
		data: storedOtp
	});
	if (typeof opts.storeOTP === "object" && "decrypt" in opts.storeOTP) return await opts.storeOTP.decrypt(storedOtp);
	return null;
}
/**
* Tries to reuse an existing unexpired OTP.
* Returns the plain-text OTP if reusable, `null` otherwise.
*/
async function tryReuseOTP(ctx, opts, identifier) {
	const existing = await ctx.context.internalAdapter.findVerificationValue(identifier);
	if (!existing || existing.expiresAt < /* @__PURE__ */ new Date()) return null;
	const [storedOtpValue, attempts] = splitAtLastColon(existing.value);
	const allowedAttempts = opts.allowedAttempts || 3;
	if (attempts && parseInt(attempts) >= allowedAttempts) return null;
	const plainOtp = await retrieveOTP(ctx, opts, storedOtpValue);
	if (!plainOtp) return null;
	await ctx.context.internalAdapter.updateVerificationByIdentifier(identifier, { expiresAt: getDate(opts.expiresIn, "sec") });
	return plainOtp;
}
//#endregion
export { storeOTP, tryReuseOTP, verifyStoredOTP };

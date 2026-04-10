import { isAPIError } from "../../utils/is-api-error.mjs";
import { APIError } from "../../api/index.mjs";
import { PACKAGE_VERSION } from "../../version.mjs";
import { getCurrentAuthContext } from "@better-auth/core/context";
import { defineErrorCodes } from "@better-auth/core/utils/error-codes";
import { createHash } from "@better-auth/utils/hash";
import { betterFetch } from "@better-fetch/fetch";
//#region src/plugins/haveibeenpwned/index.ts
const ERROR_CODES = defineErrorCodes({ PASSWORD_COMPROMISED: "The password you entered has been compromised. Please choose a different password." });
async function checkPasswordCompromise(password, customMessage) {
	if (!password) return;
	const sha1Hash = (await createHash("SHA-1", "hex").digest(password)).toUpperCase();
	const prefix = sha1Hash.substring(0, 5);
	const suffix = sha1Hash.substring(5);
	try {
		const { data, error } = await betterFetch(`https://api.pwnedpasswords.com/range/${prefix}`, { headers: {
			"Add-Padding": "true",
			"User-Agent": "BetterAuth Password Checker"
		} });
		if (error) throw new APIError("INTERNAL_SERVER_ERROR", { message: `Failed to check password. Status: ${error.status}` });
		if (data.split("\n").some((line) => line.split(":")[0].toUpperCase() === suffix.toUpperCase())) throw APIError.from("BAD_REQUEST", {
			message: customMessage || ERROR_CODES.PASSWORD_COMPROMISED.message,
			code: ERROR_CODES.PASSWORD_COMPROMISED.code
		});
	} catch (error) {
		if (isAPIError(error)) throw error;
		throw new APIError("INTERNAL_SERVER_ERROR", { message: "Failed to check password. Please try again later." });
	}
}
const haveIBeenPwned = (options) => {
	const paths = options?.paths || [
		"/sign-up/email",
		"/change-password",
		"/reset-password"
	];
	return {
		id: "have-i-been-pwned",
		version: PACKAGE_VERSION,
		init(ctx) {
			const originalHash = ctx.password.hash;
			return { context: { password: {
				...ctx.password,
				async hash(password) {
					if (options?.enabled === false) return originalHash(password);
					const c = await getCurrentAuthContext();
					if (!c.path || !paths.includes(c.path)) return originalHash(password);
					await checkPasswordCompromise(password, options?.customPasswordCompromisedMessage);
					return originalHash(password);
				}
			} } };
		},
		options,
		$ERROR_CODES: ERROR_CODES
	};
};
//#endregion
export { haveIBeenPwned };

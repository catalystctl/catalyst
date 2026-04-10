import { PACKAGE_VERSION } from "../../version.mjs";
import { EMAIL_OTP_ERROR_CODES } from "./error-codes.mjs";
//#region src/plugins/email-otp/client.ts
const emailOTPClient = () => {
	return {
		id: "email-otp",
		version: PACKAGE_VERSION,
		$InferServerPlugin: {},
		atomListeners: [{
			matcher: (path) => path === "/email-otp/verify-email" || path === "/sign-in/email-otp" || path === "/email-otp/request-email-change",
			signal: "$sessionSignal"
		}],
		$ERROR_CODES: EMAIL_OTP_ERROR_CODES
	};
};
//#endregion
export { emailOTPClient };

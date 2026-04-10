import { PACKAGE_VERSION } from "../../version.mjs";
import { PHONE_NUMBER_ERROR_CODES } from "./error-codes.mjs";
//#region src/plugins/phone-number/client.ts
const phoneNumberClient = () => {
	return {
		id: "phoneNumber",
		version: PACKAGE_VERSION,
		$InferServerPlugin: {},
		atomListeners: [{
			matcher(path) {
				return path === "/phone-number/update" || path === "/phone-number/verify" || path === "/sign-in/phone-number";
			},
			signal: "$sessionSignal"
		}],
		$ERROR_CODES: PHONE_NUMBER_ERROR_CODES
	};
};
//#endregion
export { phoneNumberClient };

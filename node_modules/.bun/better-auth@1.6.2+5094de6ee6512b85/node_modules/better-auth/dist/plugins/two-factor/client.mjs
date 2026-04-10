import { PACKAGE_VERSION } from "../../version.mjs";
import { TWO_FACTOR_ERROR_CODES } from "./error-code.mjs";
//#region src/plugins/two-factor/client.ts
const twoFactorClient = (options) => {
	return {
		id: "two-factor",
		version: PACKAGE_VERSION,
		$InferServerPlugin: {},
		atomListeners: [{
			matcher: (path) => path.startsWith("/two-factor/"),
			signal: "$sessionSignal"
		}],
		pathMethods: {
			"/two-factor/disable": "POST",
			"/two-factor/enable": "POST",
			"/two-factor/send-otp": "POST",
			"/two-factor/generate-backup-codes": "POST",
			"/two-factor/get-totp-uri": "POST",
			"/two-factor/verify-totp": "POST",
			"/two-factor/verify-otp": "POST",
			"/two-factor/verify-backup-code": "POST"
		},
		fetchPlugins: [{
			id: "two-factor",
			name: "two-factor",
			hooks: { async onSuccess(context) {
				if (context.data?.twoFactorRedirect) {
					if (options?.onTwoFactorRedirect) {
						await options.onTwoFactorRedirect({ twoFactorMethods: context.data.twoFactorMethods });
						return;
					}
					if (options?.twoFactorPage && typeof window !== "undefined") window.location.href = options.twoFactorPage;
				}
			} }
		}],
		$ERROR_CODES: TWO_FACTOR_ERROR_CODES
	};
};
//#endregion
export { twoFactorClient };

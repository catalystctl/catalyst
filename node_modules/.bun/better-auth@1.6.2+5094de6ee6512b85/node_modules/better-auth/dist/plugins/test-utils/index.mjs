import { PACKAGE_VERSION } from "../../version.mjs";
import { createGetAuthHeaders, createGetCookies, createLogin } from "./auth-helpers.mjs";
import { createAddMember, createDeleteOrganization, createDeleteUser, createSaveOrganization, createSaveUser } from "./db-helpers.mjs";
import { createOrganizationFactory, createUserFactory } from "./factories.mjs";
import { createOTPStore } from "./otp-sink.mjs";
//#region src/plugins/test-utils/index.ts
/**
* Test utilities plugin for Better Auth.
*
* Provides helpers for integration and E2E testing including:
* - User/Organization factories (creates objects without DB writes)
* - Database helpers (save, delete)
* - Auth helpers (login, getAuthHeaders, getCookies)
* - OTP capture (when captureOTP: true)
*
* @example
* ```ts
* import { betterAuth } from "better-auth";
* import { testUtils } from "better-auth/plugins";
*
* export const auth = betterAuth({
*   plugins: [
*     testUtils({ captureOTP: true }),
*   ],
* });
*
* // In tests, access helpers via context:
* const ctx = await auth.$context;
* const test = ctx.test;
*
* const user = test.createUser({ email: "test@example.com" });
* const savedUser = await test.saveUser(user);
* const { headers, cookies } = await test.login({ userId: user.id });
* ```
*/
const testUtils = (options = {}) => {
	return {
		id: "test-utils",
		version: PACKAGE_VERSION,
		init(ctx) {
			const hasOrgPlugin = ctx.hasPlugin("organization");
			const helpers = {
				createUser: createUserFactory(ctx),
				saveUser: createSaveUser(ctx),
				deleteUser: createDeleteUser(ctx),
				login: createLogin(ctx),
				getAuthHeaders: createGetAuthHeaders(ctx),
				getCookies: createGetCookies(ctx)
			};
			if (hasOrgPlugin) {
				helpers.createOrganization = createOrganizationFactory(ctx);
				helpers.saveOrganization = createSaveOrganization(ctx);
				helpers.deleteOrganization = createDeleteOrganization(ctx);
				helpers.addMember = createAddMember(ctx);
			}
			const otpStore = createOTPStore();
			if (options.captureOTP) {
				helpers.getOTP = otpStore.get;
				helpers.clearOTPs = otpStore.clear;
			}
			const databaseHooks = options.captureOTP ? { verification: { create: { async after(verification) {
				if (verification?.value && verification?.identifier) {
					const otpPart = verification.value.split(":")[0];
					if (otpPart) {
						let identifier = verification.identifier;
						for (const prefix of [
							"email-verification-otp-",
							"sign-in-otp-",
							"forget-password-otp-",
							"phone-verification-otp-"
						]) if (identifier.startsWith(prefix)) {
							identifier = identifier.slice(prefix.length);
							break;
						}
						otpStore.capture(identifier, otpPart);
					}
				}
			} } } } : null;
			return {
				context: { test: helpers },
				options: databaseHooks ? { databaseHooks } : void 0
			};
		},
		options
	};
};
//#endregion
export { testUtils };

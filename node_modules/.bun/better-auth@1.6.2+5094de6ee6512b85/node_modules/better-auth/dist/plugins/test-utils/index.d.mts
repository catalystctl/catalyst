import { LoginResult, TestCookie, TestHelpers, TestUtilsOptions } from "./types.mjs";
import * as _better_auth_core0 from "@better-auth/core";

//#region src/plugins/test-utils/index.d.ts
declare module "@better-auth/core" {
  interface BetterAuthPluginRegistry<AuthOptions, Options> {
    "test-utils": {
      creator: typeof testUtils;
    };
  }
}
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
declare const testUtils: (options?: TestUtilsOptions) => {
  id: "test-utils";
  version: string;
  init(ctx: _better_auth_core0.AuthContext): {
    context: {
      test: TestHelpers;
    };
    options: {
      databaseHooks: {
        verification: {
          create: {
            after(verification: {
              identifier: string;
              value: string;
            } | null): Promise<void>;
          };
        };
      };
    } | undefined;
  };
  options: TestUtilsOptions;
};
//#endregion
export { testUtils };
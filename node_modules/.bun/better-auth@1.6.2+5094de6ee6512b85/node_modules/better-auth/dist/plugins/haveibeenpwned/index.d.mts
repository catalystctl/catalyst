import * as _better_auth_core0 from "@better-auth/core";
import * as _better_auth_core_utils_error_codes0 from "@better-auth/core/utils/error-codes";

//#region src/plugins/haveibeenpwned/index.d.ts
declare module "@better-auth/core" {
  interface BetterAuthPluginRegistry<AuthOptions, Options> {
    "have-i-been-pwned": {
      creator: typeof haveIBeenPwned;
    };
  }
}
interface HaveIBeenPwnedOptions {
  /**
   * Custom error message shown when a compromised password is detected.
   */
  customPasswordCompromisedMessage?: string | undefined;
  /**
   * Paths to check for password
   *
   * @default ["/sign-up/email", "/change-password", "/reset-password"]
   */
  paths?: string[];
  /**
   * Enable or disable password checks against the HIBP database.
   *
   * @default true
   */
  enabled?: boolean | undefined;
}
declare const haveIBeenPwned: (options?: HaveIBeenPwnedOptions | undefined) => {
  id: "have-i-been-pwned";
  version: string;
  init(ctx: _better_auth_core0.AuthContext): {
    context: {
      password: {
        hash(password: string): Promise<string>;
        verify: (data: {
          password: string;
          hash: string;
        }) => Promise<boolean>;
        config: {
          minPasswordLength: number;
          maxPasswordLength: number;
        };
        checkPassword: (userId: string, ctx: _better_auth_core0.GenericEndpointContext<_better_auth_core0.BetterAuthOptions>) => Promise<boolean>;
      };
    };
  };
  options: HaveIBeenPwnedOptions | undefined;
  $ERROR_CODES: {
    PASSWORD_COMPROMISED: _better_auth_core_utils_error_codes0.RawError<"PASSWORD_COMPROMISED">;
  };
};
//#endregion
export { HaveIBeenPwnedOptions, haveIBeenPwned };
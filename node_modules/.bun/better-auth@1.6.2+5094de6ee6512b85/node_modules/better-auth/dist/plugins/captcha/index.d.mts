import { BaseCaptchaOptions, CaptchaFoxOptions, CaptchaOptions, CloudflareTurnstileOptions, GoogleRecaptchaOptions, HCaptchaOptions, Provider } from "./types.mjs";
import * as _better_auth_core0 from "@better-auth/core";
import * as _better_auth_core_utils_error_codes0 from "@better-auth/core/utils/error-codes";

//#region src/plugins/captcha/index.d.ts
declare module "@better-auth/core" {
  interface BetterAuthPluginRegistry<AuthOptions, Options> {
    captcha: {
      creator: typeof captcha;
    };
  }
}
declare const captcha: (options: CaptchaOptions) => {
  id: "captcha";
  version: string;
  $ERROR_CODES: {
    VERIFICATION_FAILED: _better_auth_core_utils_error_codes0.RawError<"VERIFICATION_FAILED">;
    MISSING_RESPONSE: _better_auth_core_utils_error_codes0.RawError<"MISSING_RESPONSE">;
    UNKNOWN_ERROR: _better_auth_core_utils_error_codes0.RawError<"UNKNOWN_ERROR">;
  };
  onRequest: (request: Request, ctx: _better_auth_core0.AuthContext) => Promise<{
    response: Response;
  } | undefined>;
  options: CaptchaOptions;
};
//#endregion
export { BaseCaptchaOptions, CaptchaFoxOptions, CaptchaOptions, CloudflareTurnstileOptions, GoogleRecaptchaOptions, HCaptchaOptions, Provider, captcha };
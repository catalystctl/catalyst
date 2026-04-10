import { emailOTP } from "./index.mjs";
import { EMAIL_OTP_ERROR_CODES } from "./error-codes.mjs";
import * as _better_auth_core_utils_error_codes0 from "@better-auth/core/utils/error-codes";

//#region src/plugins/email-otp/client.d.ts
declare const emailOTPClient: () => {
  id: "email-otp";
  version: string;
  $InferServerPlugin: ReturnType<typeof emailOTP>;
  atomListeners: {
    matcher: (path: string) => path is "/email-otp/verify-email" | "/sign-in/email-otp" | "/email-otp/request-email-change";
    signal: "$sessionSignal";
  }[];
  $ERROR_CODES: {
    OTP_EXPIRED: _better_auth_core_utils_error_codes0.RawError<"OTP_EXPIRED">;
    INVALID_OTP: _better_auth_core_utils_error_codes0.RawError<"INVALID_OTP">;
    TOO_MANY_ATTEMPTS: _better_auth_core_utils_error_codes0.RawError<"TOO_MANY_ATTEMPTS">;
  };
};
//#endregion
export { emailOTPClient };
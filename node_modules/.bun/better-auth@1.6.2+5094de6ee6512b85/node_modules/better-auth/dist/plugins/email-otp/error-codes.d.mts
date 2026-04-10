import * as _better_auth_core_utils_error_codes0 from "@better-auth/core/utils/error-codes";

//#region src/plugins/email-otp/error-codes.d.ts
declare const EMAIL_OTP_ERROR_CODES: {
  OTP_EXPIRED: _better_auth_core_utils_error_codes0.RawError<"OTP_EXPIRED">;
  INVALID_OTP: _better_auth_core_utils_error_codes0.RawError<"INVALID_OTP">;
  TOO_MANY_ATTEMPTS: _better_auth_core_utils_error_codes0.RawError<"TOO_MANY_ATTEMPTS">;
};
//#endregion
export { EMAIL_OTP_ERROR_CODES };
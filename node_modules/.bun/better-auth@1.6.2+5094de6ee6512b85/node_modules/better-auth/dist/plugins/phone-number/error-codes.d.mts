import * as _better_auth_core_utils_error_codes0 from "@better-auth/core/utils/error-codes";

//#region src/plugins/phone-number/error-codes.d.ts
declare const PHONE_NUMBER_ERROR_CODES: {
  OTP_EXPIRED: _better_auth_core_utils_error_codes0.RawError<"OTP_EXPIRED">;
  INVALID_OTP: _better_auth_core_utils_error_codes0.RawError<"INVALID_OTP">;
  TOO_MANY_ATTEMPTS: _better_auth_core_utils_error_codes0.RawError<"TOO_MANY_ATTEMPTS">;
  INVALID_PHONE_NUMBER: _better_auth_core_utils_error_codes0.RawError<"INVALID_PHONE_NUMBER">;
  PHONE_NUMBER_EXIST: _better_auth_core_utils_error_codes0.RawError<"PHONE_NUMBER_EXIST">;
  PHONE_NUMBER_NOT_EXIST: _better_auth_core_utils_error_codes0.RawError<"PHONE_NUMBER_NOT_EXIST">;
  INVALID_PHONE_NUMBER_OR_PASSWORD: _better_auth_core_utils_error_codes0.RawError<"INVALID_PHONE_NUMBER_OR_PASSWORD">;
  UNEXPECTED_ERROR: _better_auth_core_utils_error_codes0.RawError<"UNEXPECTED_ERROR">;
  OTP_NOT_FOUND: _better_auth_core_utils_error_codes0.RawError<"OTP_NOT_FOUND">;
  PHONE_NUMBER_NOT_VERIFIED: _better_auth_core_utils_error_codes0.RawError<"PHONE_NUMBER_NOT_VERIFIED">;
  PHONE_NUMBER_CANNOT_BE_UPDATED: _better_auth_core_utils_error_codes0.RawError<"PHONE_NUMBER_CANNOT_BE_UPDATED">;
  SEND_OTP_NOT_IMPLEMENTED: _better_auth_core_utils_error_codes0.RawError<"SEND_OTP_NOT_IMPLEMENTED">;
};
//#endregion
export { PHONE_NUMBER_ERROR_CODES };
import * as _better_auth_core_utils_error_codes0 from "@better-auth/core/utils/error-codes";

//#region src/plugins/generic-oauth/error-codes.d.ts
declare const GENERIC_OAUTH_ERROR_CODES: {
  INVALID_OAUTH_CONFIGURATION: _better_auth_core_utils_error_codes0.RawError<"INVALID_OAUTH_CONFIGURATION">;
  TOKEN_URL_NOT_FOUND: _better_auth_core_utils_error_codes0.RawError<"TOKEN_URL_NOT_FOUND">;
  PROVIDER_CONFIG_NOT_FOUND: _better_auth_core_utils_error_codes0.RawError<"PROVIDER_CONFIG_NOT_FOUND">;
  PROVIDER_ID_REQUIRED: _better_auth_core_utils_error_codes0.RawError<"PROVIDER_ID_REQUIRED">;
  INVALID_OAUTH_CONFIG: _better_auth_core_utils_error_codes0.RawError<"INVALID_OAUTH_CONFIG">;
  SESSION_REQUIRED: _better_auth_core_utils_error_codes0.RawError<"SESSION_REQUIRED">;
  ISSUER_MISMATCH: _better_auth_core_utils_error_codes0.RawError<"ISSUER_MISMATCH">;
  ISSUER_MISSING: _better_auth_core_utils_error_codes0.RawError<"ISSUER_MISSING">;
};
//#endregion
export { GENERIC_OAUTH_ERROR_CODES };
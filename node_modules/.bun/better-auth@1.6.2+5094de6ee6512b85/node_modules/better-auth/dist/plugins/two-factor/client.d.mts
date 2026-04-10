import { BackupCodeOptions, backupCode2fa, generateBackupCodes, getBackupCodes, verifyBackupCode } from "./backup-codes/index.mjs";
import { OTPOptions, otp2fa } from "./otp/index.mjs";
import { TOTPOptions, totp2fa } from "./totp/index.mjs";
import { TwoFactorOptions, TwoFactorProvider, TwoFactorTable, UserWithTwoFactor } from "./types.mjs";
import { TWO_FACTOR_ERROR_CODES } from "./error-code.mjs";
import { twoFactor } from "./index.mjs";
import * as _better_auth_core_utils_error_codes0 from "@better-auth/core/utils/error-codes";
import * as _better_fetch_fetch0 from "@better-fetch/fetch";

//#region src/plugins/two-factor/client.d.ts
declare const twoFactorClient: (options?: {
  /**
   * the page to redirect if a user needs to verify
   * their two factor
   *
   * @warning This causes a full page reload when used.
   */
  twoFactorPage?: string;
  /**
   * a redirect function to call if a user needs to verify
   * their two factor
   *
   * @param context.twoFactorMethods - The list of
   * enabled two factor providers (e.g. ["totp", "otp"]).
   * Use this to determine which 2FA UI to show.
   */
  onTwoFactorRedirect?: (context: {
    /**
     * The list of enabled two factor providers
     * for the user (e.g. ["totp", "otp"]).
     */
    twoFactorMethods?: string[];
  }) => void | Promise<void>;
} | undefined) => {
  id: "two-factor";
  version: string;
  $InferServerPlugin: ReturnType<typeof twoFactor>;
  atomListeners: {
    matcher: (path: string) => boolean;
    signal: "$sessionSignal";
  }[];
  pathMethods: {
    "/two-factor/disable": "POST";
    "/two-factor/enable": "POST";
    "/two-factor/send-otp": "POST";
    "/two-factor/generate-backup-codes": "POST";
    "/two-factor/get-totp-uri": "POST";
    "/two-factor/verify-totp": "POST";
    "/two-factor/verify-otp": "POST";
    "/two-factor/verify-backup-code": "POST";
  };
  fetchPlugins: {
    id: string;
    name: string;
    hooks: {
      onSuccess(context: _better_fetch_fetch0.SuccessContext<any>): Promise<void>;
    };
  }[];
  $ERROR_CODES: {
    OTP_NOT_ENABLED: _better_auth_core_utils_error_codes0.RawError<"OTP_NOT_ENABLED">;
    OTP_HAS_EXPIRED: _better_auth_core_utils_error_codes0.RawError<"OTP_HAS_EXPIRED">;
    TOTP_NOT_ENABLED: _better_auth_core_utils_error_codes0.RawError<"TOTP_NOT_ENABLED">;
    TWO_FACTOR_NOT_ENABLED: _better_auth_core_utils_error_codes0.RawError<"TWO_FACTOR_NOT_ENABLED">;
    BACKUP_CODES_NOT_ENABLED: _better_auth_core_utils_error_codes0.RawError<"BACKUP_CODES_NOT_ENABLED">;
    INVALID_BACKUP_CODE: _better_auth_core_utils_error_codes0.RawError<"INVALID_BACKUP_CODE">;
    INVALID_CODE: _better_auth_core_utils_error_codes0.RawError<"INVALID_CODE">;
    TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE: _better_auth_core_utils_error_codes0.RawError<"TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE">;
    INVALID_TWO_FACTOR_COOKIE: _better_auth_core_utils_error_codes0.RawError<"INVALID_TWO_FACTOR_COOKIE">;
  };
};
//#endregion
export { twoFactorClient };
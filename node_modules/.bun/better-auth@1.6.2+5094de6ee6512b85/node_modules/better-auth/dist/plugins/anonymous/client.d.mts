import { schema } from "./schema.mjs";
import { AnonymousOptions, AnonymousSession, UserWithAnonymous } from "./types.mjs";
import { anonymous } from "./index.mjs";
import { ANONYMOUS_ERROR_CODES } from "./error-codes.mjs";
import * as _better_auth_core_utils_error_codes0 from "@better-auth/core/utils/error-codes";

//#region src/plugins/anonymous/client.d.ts
declare const anonymousClient: () => {
  id: "anonymous";
  version: string;
  $InferServerPlugin: ReturnType<typeof anonymous>;
  pathMethods: {
    "/sign-in/anonymous": "POST";
    "/delete-anonymous-user": "POST";
  };
  atomListeners: {
    matcher: (path: string) => path is "/sign-in/anonymous";
    signal: "$sessionSignal";
  }[];
  $ERROR_CODES: {
    FAILED_TO_CREATE_USER: _better_auth_core_utils_error_codes0.RawError<"FAILED_TO_CREATE_USER">;
    INVALID_EMAIL_FORMAT: _better_auth_core_utils_error_codes0.RawError<"INVALID_EMAIL_FORMAT">;
    COULD_NOT_CREATE_SESSION: _better_auth_core_utils_error_codes0.RawError<"COULD_NOT_CREATE_SESSION">;
    ANONYMOUS_USERS_CANNOT_SIGN_IN_AGAIN_ANONYMOUSLY: _better_auth_core_utils_error_codes0.RawError<"ANONYMOUS_USERS_CANNOT_SIGN_IN_AGAIN_ANONYMOUSLY">;
    FAILED_TO_DELETE_ANONYMOUS_USER: _better_auth_core_utils_error_codes0.RawError<"FAILED_TO_DELETE_ANONYMOUS_USER">;
    USER_IS_NOT_ANONYMOUS: _better_auth_core_utils_error_codes0.RawError<"USER_IS_NOT_ANONYMOUS">;
    DELETE_ANONYMOUS_USER_DISABLED: _better_auth_core_utils_error_codes0.RawError<"DELETE_ANONYMOUS_USER_DISABLED">;
  };
};
//#endregion
export { anonymousClient };
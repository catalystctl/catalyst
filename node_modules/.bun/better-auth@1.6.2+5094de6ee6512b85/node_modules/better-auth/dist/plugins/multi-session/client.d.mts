import { MULTI_SESSION_ERROR_CODES } from "./error-codes.mjs";
import { MultiSessionConfig, multiSession } from "./index.mjs";
import * as _better_auth_core_utils_error_codes0 from "@better-auth/core/utils/error-codes";

//#region src/plugins/multi-session/client.d.ts
declare const multiSessionClient: () => {
  id: "multi-session";
  version: string;
  $InferServerPlugin: ReturnType<typeof multiSession>;
  atomListeners: {
    matcher(path: string): path is "/multi-session/set-active";
    signal: "$sessionSignal";
  }[];
  $ERROR_CODES: {
    INVALID_SESSION_TOKEN: _better_auth_core_utils_error_codes0.RawError<"INVALID_SESSION_TOKEN">;
  };
};
//#endregion
export { multiSessionClient };
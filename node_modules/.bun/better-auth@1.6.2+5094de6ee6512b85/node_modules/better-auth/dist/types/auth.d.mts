import { InferAPI } from "./api.mjs";
import { InferPluginTypes, Session, User } from "./models.mjs";
import { InferPluginContext, InferPluginErrorCodes } from "./plugins.mjs";
import { router } from "../api/index.mjs";
import { AuthContext, BetterAuthOptions } from "@better-auth/core";
import { BASE_ERROR_CODES } from "@better-auth/core/error";

//#region src/types/auth.d.ts
type Auth<Options extends BetterAuthOptions = BetterAuthOptions> = {
  handler: (request: Request) => Promise<Response>;
  api: InferAPI<ReturnType<typeof router<Options>>["endpoints"]>;
  options: Options;
  $ERROR_CODES: InferPluginErrorCodes<Options> & typeof BASE_ERROR_CODES;
  $context: Promise<AuthContext<Options> & InferPluginContext<Options>>;
  /**
   * Share types
   */
  $Infer: InferPluginTypes<Options> extends {
    Session: any;
  } ? InferPluginTypes<Options> : {
    Session: {
      session: Session<Options["session"], Options["plugins"]>;
      user: User<Options["user"], Options["plugins"]>;
    };
  } & InferPluginTypes<Options>;
};
//#endregion
export { Auth };
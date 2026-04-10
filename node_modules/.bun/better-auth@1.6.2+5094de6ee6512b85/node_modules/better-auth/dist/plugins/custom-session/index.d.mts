import * as _better_auth_core0 from "@better-auth/core";
import { BetterAuthOptions, GenericEndpointContext } from "@better-auth/core";
import { Session, User } from "@better-auth/core/db";
import * as better_call0 from "better-call";
import * as z from "zod";

//#region src/plugins/custom-session/index.d.ts
declare module "@better-auth/core" {
  interface BetterAuthPluginRegistry<AuthOptions, Options> {
    "custom-session": {
      creator: typeof customSession;
    };
  }
}
type CustomSessionPluginOptions = {
  /**
   * This option is used to determine if the list-device-sessions endpoint should be mutated to the custom session data.
   * @default false
   */
  shouldMutateListDeviceSessionsEndpoint?: boolean | undefined;
};
declare const customSession: <Returns extends Record<string, any>, O extends BetterAuthOptions = BetterAuthOptions>(fn: (session: {
  user: User<O["user"], O["plugins"]>;
  session: Session<O["session"], O["plugins"]>;
}, ctx: GenericEndpointContext) => Promise<Returns>, options?: O | undefined, pluginOptions?: CustomSessionPluginOptions | undefined) => {
  id: "custom-session";
  version: string;
  hooks: {
    after: {
      matcher: (ctx: _better_auth_core0.HookEndpointContext) => boolean;
      handler: (inputContext: better_call0.MiddlewareInputContext<better_call0.MiddlewareOptions>) => Promise<Awaited<Returns>[] | undefined>;
    }[];
  };
  endpoints: {
    getSession: better_call0.StrictEndpoint<"/get-session", {
      method: "GET";
      query: z.ZodOptional<z.ZodObject<{
        disableCookieCache: z.ZodOptional<z.ZodUnion<[z.ZodBoolean, z.ZodPipe<z.ZodString, z.ZodTransform<boolean, string>>]>>;
        disableRefresh: z.ZodOptional<z.ZodBoolean>;
      }, z.core.$strip>>;
      metadata: {
        CUSTOM_SESSION: boolean;
        openapi: {
          description: string;
          responses: {
            "200": {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "array";
                    nullable: boolean;
                    items: {
                      $ref: string;
                    };
                  };
                };
              };
            };
          };
        };
      };
      requireHeaders: true;
    }, Returns | null>;
  };
  $Infer: {
    Session: Awaited<ReturnType<typeof fn>>;
  };
  options: CustomSessionPluginOptions | undefined;
};
//#endregion
export { CustomSessionPluginOptions, customSession };
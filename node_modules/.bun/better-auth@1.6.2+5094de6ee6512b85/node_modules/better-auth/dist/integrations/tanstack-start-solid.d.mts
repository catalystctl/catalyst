import * as _better_auth_core0 from "@better-auth/core";
import * as better_call0 from "better-call";

//#region src/integrations/tanstack-start-solid.d.ts
/**
 * TanStack Start cookie plugin for Solid.js.
 *
 * This plugin automatically handles cookie setting for TanStack Start with Solid.js.
 * It uses `@tanstack/solid-start-server` to set cookies.
 *
 * For React, use `better-auth/tanstack-start` instead.
 *
 * @example
 * ```ts
 * import { tanstackStartCookies } from "better-auth/tanstack-start/solid";
 *
 * const auth = betterAuth({
 *   plugins: [tanstackStartCookies()],
 * });
 * ```
 */
declare const tanstackStartCookies: () => {
  id: "tanstack-start-cookies-solid";
  version: string;
  hooks: {
    after: {
      matcher(ctx: _better_auth_core0.HookEndpointContext): true;
      handler: (inputContext: better_call0.MiddlewareInputContext<better_call0.MiddlewareOptions>) => Promise<void>;
    }[];
  };
};
//#endregion
export { tanstackStartCookies };
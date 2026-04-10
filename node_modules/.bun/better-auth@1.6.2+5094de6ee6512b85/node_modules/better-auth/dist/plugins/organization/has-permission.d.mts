import { HasPermissionBaseInput } from "./permission.mjs";
import { GenericEndpointContext } from "@better-auth/core";

//#region src/plugins/organization/has-permission.d.ts
declare const hasPermission: (input: {
  organizationId: string;
  /**
   * If true, will use the in-memory cache of the roles.
   * Keep in mind to use this in a stateless mindset, the purpose of this is to avoid unnecessary database calls when running multiple
   * hasPermission calls in a row.
   *
   * @default false
   */
  useMemoryCache?: boolean | undefined;
} & HasPermissionBaseInput, ctx: GenericEndpointContext) => Promise<boolean>;
//#endregion
export { hasPermission };
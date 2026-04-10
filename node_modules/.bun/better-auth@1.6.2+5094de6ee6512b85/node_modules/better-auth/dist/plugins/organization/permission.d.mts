import { OrganizationOptions } from "./types.mjs";

//#region src/plugins/organization/permission.d.ts
type PermissionExclusive = {
  permissions: {
    [key: string]: string[];
  };
};
type HasPermissionBaseInput = {
  role: string;
  options: OrganizationOptions;
  allowCreatorAllPermissions?: boolean | undefined;
} & PermissionExclusive;
//#endregion
export { HasPermissionBaseInput };
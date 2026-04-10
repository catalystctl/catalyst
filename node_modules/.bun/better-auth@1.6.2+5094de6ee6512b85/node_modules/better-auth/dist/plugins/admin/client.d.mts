import { AccessControl, ArrayElement, Role, Statements } from "../access/types.mjs";
import { AdminOptions, InferAdminRolesFromOption, SessionWithImpersonatedBy, UserWithRole } from "./types.mjs";
import { admin } from "./admin.mjs";
import { ADMIN_ERROR_CODES } from "./error-codes.mjs";
import * as _better_auth_core_utils_error_codes0 from "@better-auth/core/utils/error-codes";

//#region src/plugins/admin/client.d.ts
interface AdminClientOptions {
  ac?: AccessControl | undefined;
  roles?: { [key in string]: Role } | undefined;
}
declare const adminClient: <O extends AdminClientOptions>(options?: O | undefined) => {
  id: "admin-client";
  version: string;
  $InferServerPlugin: ReturnType<typeof admin<{
    ac: O["ac"] extends AccessControl ? O["ac"] : AccessControl<{
      readonly user: readonly ["create", "list", "set-role", "ban", "impersonate", "impersonate-admins", "delete", "set-password", "get", "update"];
      readonly session: readonly ["list", "revoke", "delete"];
    }>;
    roles: O["roles"] extends Record<string, Role> ? O["roles"] : {
      admin: Role;
      user: Role;
    };
  }>>;
  getActions: () => {
    admin: {
      checkRolePermission: <R extends (O extends {
        roles: any;
      } ? keyof O["roles"] : "admin" | "user")>(data: {
        permissions: { [key in keyof (O["ac"] extends AccessControl<infer S extends Statements> ? S : {
          readonly user: readonly ["create", "list", "set-role", "ban", "impersonate", "impersonate-admins", "delete", "set-password", "get", "update"];
          readonly session: readonly ["list", "revoke", "delete"];
        })]?: ((O["ac"] extends AccessControl<infer S extends Statements> ? S : {
          readonly user: readonly ["create", "list", "set-role", "ban", "impersonate", "impersonate-admins", "delete", "set-password", "get", "update"];
          readonly session: readonly ["list", "revoke", "delete"];
        })[key] extends readonly unknown[] ? ArrayElement<(O["ac"] extends AccessControl<infer S extends Statements> ? S : {
          readonly user: readonly ["create", "list", "set-role", "ban", "impersonate", "impersonate-admins", "delete", "set-password", "get", "update"];
          readonly session: readonly ["list", "revoke", "delete"];
        })[key]> : never)[] | undefined };
      } & {
        role: R;
      }) => boolean;
    };
  };
  pathMethods: {
    "/admin/list-users": "GET";
    "/admin/stop-impersonating": "POST";
  };
  $ERROR_CODES: {
    USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: _better_auth_core_utils_error_codes0.RawError<"USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL">;
    FAILED_TO_CREATE_USER: _better_auth_core_utils_error_codes0.RawError<"FAILED_TO_CREATE_USER">;
    USER_ALREADY_EXISTS: _better_auth_core_utils_error_codes0.RawError<"USER_ALREADY_EXISTS">;
    YOU_CANNOT_BAN_YOURSELF: _better_auth_core_utils_error_codes0.RawError<"YOU_CANNOT_BAN_YOURSELF">;
    YOU_ARE_NOT_ALLOWED_TO_CHANGE_USERS_ROLE: _better_auth_core_utils_error_codes0.RawError<"YOU_ARE_NOT_ALLOWED_TO_CHANGE_USERS_ROLE">;
    YOU_ARE_NOT_ALLOWED_TO_CREATE_USERS: _better_auth_core_utils_error_codes0.RawError<"YOU_ARE_NOT_ALLOWED_TO_CREATE_USERS">;
    YOU_ARE_NOT_ALLOWED_TO_LIST_USERS: _better_auth_core_utils_error_codes0.RawError<"YOU_ARE_NOT_ALLOWED_TO_LIST_USERS">;
    YOU_ARE_NOT_ALLOWED_TO_LIST_USERS_SESSIONS: _better_auth_core_utils_error_codes0.RawError<"YOU_ARE_NOT_ALLOWED_TO_LIST_USERS_SESSIONS">;
    YOU_ARE_NOT_ALLOWED_TO_BAN_USERS: _better_auth_core_utils_error_codes0.RawError<"YOU_ARE_NOT_ALLOWED_TO_BAN_USERS">;
    YOU_ARE_NOT_ALLOWED_TO_IMPERSONATE_USERS: _better_auth_core_utils_error_codes0.RawError<"YOU_ARE_NOT_ALLOWED_TO_IMPERSONATE_USERS">;
    YOU_ARE_NOT_ALLOWED_TO_REVOKE_USERS_SESSIONS: _better_auth_core_utils_error_codes0.RawError<"YOU_ARE_NOT_ALLOWED_TO_REVOKE_USERS_SESSIONS">;
    YOU_ARE_NOT_ALLOWED_TO_DELETE_USERS: _better_auth_core_utils_error_codes0.RawError<"YOU_ARE_NOT_ALLOWED_TO_DELETE_USERS">;
    YOU_ARE_NOT_ALLOWED_TO_SET_USERS_PASSWORD: _better_auth_core_utils_error_codes0.RawError<"YOU_ARE_NOT_ALLOWED_TO_SET_USERS_PASSWORD">;
    BANNED_USER: _better_auth_core_utils_error_codes0.RawError<"BANNED_USER">;
    YOU_ARE_NOT_ALLOWED_TO_GET_USER: _better_auth_core_utils_error_codes0.RawError<"YOU_ARE_NOT_ALLOWED_TO_GET_USER">;
    NO_DATA_TO_UPDATE: _better_auth_core_utils_error_codes0.RawError<"NO_DATA_TO_UPDATE">;
    YOU_ARE_NOT_ALLOWED_TO_UPDATE_USERS: _better_auth_core_utils_error_codes0.RawError<"YOU_ARE_NOT_ALLOWED_TO_UPDATE_USERS">;
    YOU_CANNOT_REMOVE_YOURSELF: _better_auth_core_utils_error_codes0.RawError<"YOU_CANNOT_REMOVE_YOURSELF">;
    YOU_ARE_NOT_ALLOWED_TO_SET_NON_EXISTENT_VALUE: _better_auth_core_utils_error_codes0.RawError<"YOU_ARE_NOT_ALLOWED_TO_SET_NON_EXISTENT_VALUE">;
    YOU_CANNOT_IMPERSONATE_ADMINS: _better_auth_core_utils_error_codes0.RawError<"YOU_CANNOT_IMPERSONATE_ADMINS">;
    INVALID_ROLE_TYPE: _better_auth_core_utils_error_codes0.RawError<"INVALID_ROLE_TYPE">;
  };
};
//#endregion
export { adminClient };
import { AccessControl, ArrayElement, Statements } from "../access/types.mjs";
import { AdminOptions, InferAdminRolesFromOption, SessionWithImpersonatedBy, UserWithRole } from "./types.mjs";
import * as _better_auth_core0 from "@better-auth/core";
import * as _better_auth_core_utils_error_codes0 from "@better-auth/core/utils/error-codes";
import * as better_call0 from "better-call";
import * as zod from "zod";
import * as zod_v4_core0 from "zod/v4/core";

//#region src/plugins/admin/admin.d.ts
declare module "@better-auth/core" {
  interface BetterAuthPluginRegistry<AuthOptions, Options> {
    admin: {
      creator: typeof admin;
    };
  }
}
declare const admin: <O extends AdminOptions>(options?: O | undefined) => {
  id: "admin";
  version: string;
  init(): {
    options: {
      databaseHooks: {
        user: {
          create: {
            before(user: {
              id: string;
              createdAt: Date;
              updatedAt: Date;
              email: string;
              emailVerified: boolean;
              name: string;
              image?: string | null | undefined;
            } & Record<string, unknown>): Promise<{
              data: {
                id: string;
                createdAt: Date;
                updatedAt: Date;
                email: string;
                emailVerified: boolean;
                name: string;
                image?: string | null | undefined;
                role: string;
              };
            }>;
          };
        };
        session: {
          create: {
            before(session: {
              id: string;
              createdAt: Date;
              updatedAt: Date;
              userId: string;
              expiresAt: Date;
              token: string;
              ipAddress?: string | null | undefined;
              userAgent?: string | null | undefined;
            } & Record<string, unknown>, ctx: _better_auth_core0.GenericEndpointContext | null): Promise<void>;
          };
        };
      };
    };
  };
  hooks: {
    after: {
      matcher(context: _better_auth_core0.HookEndpointContext): boolean;
      handler: (inputContext: better_call0.MiddlewareInputContext<better_call0.MiddlewareOptions>) => Promise<SessionWithImpersonatedBy[] | undefined>;
    }[];
  };
  endpoints: {
    setRole: better_call0.StrictEndpoint<"/admin/set-role", {
      method: "POST";
      body: zod.ZodObject<{
        userId: zod.ZodCoercedString<unknown>;
        role: zod.ZodUnion<readonly [zod.ZodString, zod.ZodArray<zod.ZodString>]>;
      }, zod_v4_core0.$strip>;
      requireHeaders: true;
      use: ((inputContext: better_call0.MiddlewareInputContext<better_call0.MiddlewareOptions>) => Promise<{
        session: {
          user: UserWithRole;
          session: {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            userId: string;
            expiresAt: Date;
            token: string;
            ipAddress?: string | null | undefined;
            userAgent?: string | null | undefined;
          };
        };
      }>)[];
      metadata: {
        openapi: {
          operationId: string;
          summary: string;
          description: string;
          responses: {
            200: {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    properties: {
                      user: {
                        $ref: string;
                      };
                    };
                  };
                };
              };
            };
          };
        };
        $Infer: {
          body: {
            userId: string;
            role: InferAdminRolesFromOption<O & Required<Pick<AdminOptions, "defaultRole" | "adminRoles" | "bannedUserMessage">>> | InferAdminRolesFromOption<O & Required<Pick<AdminOptions, "defaultRole" | "adminRoles" | "bannedUserMessage">>>[];
          };
        };
      };
    }, {
      user: UserWithRole;
    }>;
    getUser: better_call0.StrictEndpoint<"/admin/get-user", {
      method: "GET";
      query: zod.ZodObject<{
        id: zod.ZodString;
      }, zod_v4_core0.$strip>;
      use: ((inputContext: better_call0.MiddlewareInputContext<better_call0.MiddlewareOptions>) => Promise<{
        session: {
          user: UserWithRole;
          session: {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            userId: string;
            expiresAt: Date;
            token: string;
            ipAddress?: string | null | undefined;
            userAgent?: string | null | undefined;
          };
        };
      }>)[];
      metadata: {
        openapi: {
          operationId: string;
          summary: string;
          description: string;
          responses: {
            200: {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    properties: {
                      user: {
                        $ref: string;
                      };
                    };
                  };
                };
              };
            };
          };
        };
      };
    }, UserWithRole>;
    createUser: better_call0.StrictEndpoint<"/admin/create-user", {
      method: "POST";
      body: zod.ZodObject<{
        email: zod.ZodString;
        password: zod.ZodOptional<zod.ZodString>;
        name: zod.ZodString;
        role: zod.ZodOptional<zod.ZodUnion<readonly [zod.ZodString, zod.ZodArray<zod.ZodString>]>>;
        data: zod.ZodOptional<zod.ZodRecord<zod.ZodString, zod.ZodAny>>;
      }, zod_v4_core0.$strip>;
      metadata: {
        openapi: {
          operationId: string;
          summary: string;
          description: string;
          responses: {
            200: {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    properties: {
                      user: {
                        $ref: string;
                      };
                    };
                  };
                };
              };
            };
          };
        };
        $Infer: {
          body: {
            email: string;
            password?: string | undefined;
            name: string;
            role?: InferAdminRolesFromOption<O & Required<Pick<AdminOptions, "defaultRole" | "adminRoles" | "bannedUserMessage">>> | InferAdminRolesFromOption<O & Required<Pick<AdminOptions, "defaultRole" | "adminRoles" | "bannedUserMessage">>>[] | undefined;
            data?: Record<string, any> | undefined;
          };
        };
      };
    }, {
      user: UserWithRole;
    }>;
    adminUpdateUser: better_call0.StrictEndpoint<"/admin/update-user", {
      method: "POST";
      body: zod.ZodObject<{
        userId: zod.ZodCoercedString<unknown>;
        data: zod.ZodRecord<zod.ZodAny, zod.ZodAny>;
      }, zod_v4_core0.$strip>;
      use: ((inputContext: better_call0.MiddlewareInputContext<better_call0.MiddlewareOptions>) => Promise<{
        session: {
          user: UserWithRole;
          session: {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            userId: string;
            expiresAt: Date;
            token: string;
            ipAddress?: string | null | undefined;
            userAgent?: string | null | undefined;
          };
        };
      }>)[];
      metadata: {
        openapi: {
          operationId: string;
          summary: string;
          description: string;
          responses: {
            200: {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    properties: {
                      user: {
                        $ref: string;
                      };
                    };
                  };
                };
              };
            };
          };
        };
      };
    }, UserWithRole>;
    listUsers: better_call0.StrictEndpoint<"/admin/list-users", {
      method: "GET";
      use: ((inputContext: better_call0.MiddlewareInputContext<better_call0.MiddlewareOptions>) => Promise<{
        session: {
          user: UserWithRole;
          session: {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            userId: string;
            expiresAt: Date;
            token: string;
            ipAddress?: string | null | undefined;
            userAgent?: string | null | undefined;
          };
        };
      }>)[];
      query: zod.ZodObject<{
        searchValue: zod.ZodOptional<zod.ZodString>;
        searchField: zod.ZodOptional<zod.ZodEnum<{
          email: "email";
          name: "name";
        }>>;
        searchOperator: zod.ZodOptional<zod.ZodEnum<{
          contains: "contains";
          starts_with: "starts_with";
          ends_with: "ends_with";
        }>>;
        limit: zod.ZodOptional<zod.ZodUnion<[zod.ZodString, zod.ZodNumber]>>;
        offset: zod.ZodOptional<zod.ZodUnion<[zod.ZodString, zod.ZodNumber]>>;
        sortBy: zod.ZodOptional<zod.ZodString>;
        sortDirection: zod.ZodOptional<zod.ZodEnum<{
          asc: "asc";
          desc: "desc";
        }>>;
        filterField: zod.ZodOptional<zod.ZodString>;
        filterValue: zod.ZodOptional<zod.ZodUnion<[zod.ZodUnion<[zod.ZodUnion<[zod.ZodUnion<[zod.ZodString, zod.ZodNumber]>, zod.ZodBoolean]>, zod.ZodArray<zod.ZodString>]>, zod.ZodArray<zod.ZodNumber>]>>;
        filterOperator: zod.ZodOptional<zod.ZodEnum<{
          eq: "eq";
          ne: "ne";
          gt: "gt";
          gte: "gte";
          lt: "lt";
          lte: "lte";
          in: "in";
          not_in: "not_in";
          contains: "contains";
          starts_with: "starts_with";
          ends_with: "ends_with";
        }>>;
      }, zod_v4_core0.$strip>;
      metadata: {
        openapi: {
          operationId: string;
          summary: string;
          description: string;
          responses: {
            200: {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    properties: {
                      users: {
                        type: string;
                        items: {
                          $ref: string;
                        };
                      };
                      total: {
                        type: string;
                      };
                      limit: {
                        type: string;
                      };
                      offset: {
                        type: string;
                      };
                    };
                    required: string[];
                  };
                };
              };
            };
          };
        };
      };
    }, {
      users: UserWithRole[];
      total: number;
    }>;
    listUserSessions: better_call0.StrictEndpoint<"/admin/list-user-sessions", {
      method: "POST";
      use: ((inputContext: better_call0.MiddlewareInputContext<better_call0.MiddlewareOptions>) => Promise<{
        session: {
          user: UserWithRole;
          session: {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            userId: string;
            expiresAt: Date;
            token: string;
            ipAddress?: string | null | undefined;
            userAgent?: string | null | undefined;
          };
        };
      }>)[];
      body: zod.ZodObject<{
        userId: zod.ZodCoercedString<unknown>;
      }, zod_v4_core0.$strip>;
      metadata: {
        openapi: {
          operationId: string;
          summary: string;
          description: string;
          responses: {
            200: {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    properties: {
                      sessions: {
                        type: string;
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
        };
      };
    }, {
      sessions: SessionWithImpersonatedBy[];
    }>;
    unbanUser: better_call0.StrictEndpoint<"/admin/unban-user", {
      method: "POST";
      body: zod.ZodObject<{
        userId: zod.ZodCoercedString<unknown>;
      }, zod_v4_core0.$strip>;
      use: ((inputContext: better_call0.MiddlewareInputContext<better_call0.MiddlewareOptions>) => Promise<{
        session: {
          user: UserWithRole;
          session: {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            userId: string;
            expiresAt: Date;
            token: string;
            ipAddress?: string | null | undefined;
            userAgent?: string | null | undefined;
          };
        };
      }>)[];
      metadata: {
        openapi: {
          operationId: string;
          summary: string;
          description: string;
          responses: {
            200: {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    properties: {
                      user: {
                        $ref: string;
                      };
                    };
                  };
                };
              };
            };
          };
        };
      };
    }, {
      user: UserWithRole;
    }>;
    banUser: better_call0.StrictEndpoint<"/admin/ban-user", {
      method: "POST";
      body: zod.ZodObject<{
        userId: zod.ZodCoercedString<unknown>;
        banReason: zod.ZodOptional<zod.ZodString>;
        banExpiresIn: zod.ZodOptional<zod.ZodNumber>;
      }, zod_v4_core0.$strip>;
      use: ((inputContext: better_call0.MiddlewareInputContext<better_call0.MiddlewareOptions>) => Promise<{
        session: {
          user: UserWithRole;
          session: {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            userId: string;
            expiresAt: Date;
            token: string;
            ipAddress?: string | null | undefined;
            userAgent?: string | null | undefined;
          };
        };
      }>)[];
      metadata: {
        openapi: {
          operationId: string;
          summary: string;
          description: string;
          responses: {
            200: {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    properties: {
                      user: {
                        $ref: string;
                      };
                    };
                  };
                };
              };
            };
          };
        };
      };
    }, {
      user: UserWithRole;
    }>;
    impersonateUser: better_call0.StrictEndpoint<"/admin/impersonate-user", {
      method: "POST";
      body: zod.ZodObject<{
        userId: zod.ZodCoercedString<unknown>;
      }, zod_v4_core0.$strip>;
      use: ((inputContext: better_call0.MiddlewareInputContext<better_call0.MiddlewareOptions>) => Promise<{
        session: {
          user: UserWithRole;
          session: {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            userId: string;
            expiresAt: Date;
            token: string;
            ipAddress?: string | null | undefined;
            userAgent?: string | null | undefined;
          };
        };
      }>)[];
      metadata: {
        openapi: {
          operationId: string;
          summary: string;
          description: string;
          responses: {
            200: {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    properties: {
                      session: {
                        $ref: string;
                      };
                      user: {
                        $ref: string;
                      };
                    };
                  };
                };
              };
            };
          };
        };
      };
    }, {
      session: {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        userId: string;
        expiresAt: Date;
        token: string;
        ipAddress?: string | null | undefined;
        userAgent?: string | null | undefined;
      };
      user: UserWithRole;
    }>;
    stopImpersonating: better_call0.StrictEndpoint<"/admin/stop-impersonating", {
      method: "POST";
      requireHeaders: true;
    }, {
      session: {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        userId: string;
        expiresAt: Date;
        token: string;
        ipAddress?: string | null | undefined;
        userAgent?: string | null | undefined;
      } & Record<string, any>;
      user: {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        email: string;
        emailVerified: boolean;
        name: string;
        image?: string | null | undefined;
      } & Record<string, any>;
    }>;
    revokeUserSession: better_call0.StrictEndpoint<"/admin/revoke-user-session", {
      method: "POST";
      body: zod.ZodObject<{
        sessionToken: zod.ZodString;
      }, zod_v4_core0.$strip>;
      use: ((inputContext: better_call0.MiddlewareInputContext<better_call0.MiddlewareOptions>) => Promise<{
        session: {
          user: UserWithRole;
          session: {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            userId: string;
            expiresAt: Date;
            token: string;
            ipAddress?: string | null | undefined;
            userAgent?: string | null | undefined;
          };
        };
      }>)[];
      metadata: {
        openapi: {
          operationId: string;
          summary: string;
          description: string;
          responses: {
            200: {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    properties: {
                      success: {
                        type: string;
                      };
                    };
                  };
                };
              };
            };
          };
        };
      };
    }, {
      success: boolean;
    }>;
    revokeUserSessions: better_call0.StrictEndpoint<"/admin/revoke-user-sessions", {
      method: "POST";
      body: zod.ZodObject<{
        userId: zod.ZodCoercedString<unknown>;
      }, zod_v4_core0.$strip>;
      use: ((inputContext: better_call0.MiddlewareInputContext<better_call0.MiddlewareOptions>) => Promise<{
        session: {
          user: UserWithRole;
          session: {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            userId: string;
            expiresAt: Date;
            token: string;
            ipAddress?: string | null | undefined;
            userAgent?: string | null | undefined;
          };
        };
      }>)[];
      metadata: {
        openapi: {
          operationId: string;
          summary: string;
          description: string;
          responses: {
            200: {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    properties: {
                      success: {
                        type: string;
                      };
                    };
                  };
                };
              };
            };
          };
        };
      };
    }, {
      success: boolean;
    }>;
    removeUser: better_call0.StrictEndpoint<"/admin/remove-user", {
      method: "POST";
      body: zod.ZodObject<{
        userId: zod.ZodCoercedString<unknown>;
      }, zod_v4_core0.$strip>;
      use: ((inputContext: better_call0.MiddlewareInputContext<better_call0.MiddlewareOptions>) => Promise<{
        session: {
          user: UserWithRole;
          session: {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            userId: string;
            expiresAt: Date;
            token: string;
            ipAddress?: string | null | undefined;
            userAgent?: string | null | undefined;
          };
        };
      }>)[];
      metadata: {
        openapi: {
          operationId: string;
          summary: string;
          description: string;
          responses: {
            200: {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    properties: {
                      success: {
                        type: string;
                      };
                    };
                  };
                };
              };
            };
          };
        };
      };
    }, {
      success: boolean;
    }>;
    setUserPassword: better_call0.StrictEndpoint<"/admin/set-user-password", {
      method: "POST";
      body: zod.ZodObject<{
        newPassword: zod.ZodString;
        userId: zod.ZodCoercedString<unknown>;
      }, zod_v4_core0.$strip>;
      use: ((inputContext: better_call0.MiddlewareInputContext<better_call0.MiddlewareOptions>) => Promise<{
        session: {
          user: UserWithRole;
          session: {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            userId: string;
            expiresAt: Date;
            token: string;
            ipAddress?: string | null | undefined;
            userAgent?: string | null | undefined;
          };
        };
      }>)[];
      metadata: {
        openapi: {
          operationId: string;
          summary: string;
          description: string;
          responses: {
            200: {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    properties: {
                      status: {
                        type: string;
                      };
                    };
                  };
                };
              };
            };
          };
        };
      };
    }, {
      status: boolean;
    }>;
    userHasPermission: better_call0.StrictEndpoint<"/admin/has-permission", {
      method: "POST";
      body: zod.ZodIntersection<zod.ZodObject<{
        userId: zod.ZodOptional<zod.ZodCoercedString<unknown>>;
        role: zod.ZodOptional<zod.ZodString>;
      }, zod_v4_core0.$strip>, zod.ZodUnion<readonly [zod.ZodObject<{
        permission: zod.ZodRecord<zod.ZodString, zod.ZodArray<zod.ZodString>>;
        permissions: zod.ZodUndefined;
      }, zod_v4_core0.$strip>, zod.ZodObject<{
        permission: zod.ZodUndefined;
        permissions: zod.ZodRecord<zod.ZodString, zod.ZodArray<zod.ZodString>>;
      }, zod_v4_core0.$strip>]>>;
      metadata: {
        openapi: {
          description: string;
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object";
                  properties: {
                    permissions: {
                      type: string;
                      description: string;
                    };
                  };
                  required: string[];
                };
              };
            };
          };
          responses: {
            "200": {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    properties: {
                      error: {
                        type: string;
                      };
                      success: {
                        type: string;
                      };
                    };
                    required: string[];
                  };
                };
              };
            };
          };
        };
        $Infer: {
          body: {
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
            userId?: string | undefined;
            role?: InferAdminRolesFromOption<O> | undefined;
          };
        };
      };
    }, {
      error: null;
      success: boolean;
    }>;
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
  schema: {
    user: {
      fields: {
        role: {
          type: "string";
          required: false;
          input: false;
        };
        banned: {
          type: "boolean";
          defaultValue: false;
          required: false;
          input: false;
        };
        banReason: {
          type: "string";
          required: false;
          input: false;
        };
        banExpires: {
          type: "date";
          required: false;
          input: false;
        };
      };
    };
    session: {
      fields: {
        impersonatedBy: {
          type: "string";
          required: false;
        };
      };
    };
  };
  options: NoInfer<O>;
};
//#endregion
export { admin };
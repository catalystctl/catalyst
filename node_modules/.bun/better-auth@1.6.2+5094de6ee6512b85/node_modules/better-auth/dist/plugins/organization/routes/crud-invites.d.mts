import { FieldAttributeToObject, InferAdditionalFieldsFromPluginOptions, RemoveFieldsWithReturnedFalse } from "../../../db/field.mjs";
import { Role } from "../../access/types.mjs";
import { OrganizationOptions } from "../types.mjs";
import { InferOrganizationRolesFromOption, InvitationStatus } from "../schema.mjs";
import { defaultRoles } from "../access/statement.mjs";
import * as _better_auth_core0 from "@better-auth/core";
import * as _better_auth_core_db0 from "@better-auth/core/db";
import * as better_call0 from "better-call";
import * as z from "zod";

//#region src/plugins/organization/routes/crud-invites.d.ts
declare const createInvitation: <O extends OrganizationOptions>(option: O) => better_call0.StrictEndpoint<"/organization/invite-member", {
  method: "POST";
  requireHeaders: true;
  use: (((inputContext: better_call0.MiddlewareInputContext<better_call0.MiddlewareOptions>) => Promise<{
    orgOptions: OrganizationOptions;
    roles: typeof defaultRoles & {
      [key: string]: Role<{}>;
    };
    getSession: (context: _better_auth_core0.GenericEndpointContext) => Promise<{
      session: {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        userId: string;
        expiresAt: Date;
        token: string;
        ipAddress?: string | null | undefined;
        userAgent?: string | null | undefined;
      } & {
        activeTeamId?: string | undefined;
        activeOrganizationId?: string | undefined;
      };
      user: {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        email: string;
        emailVerified: boolean;
        name: string;
        image?: string | null | undefined;
      };
    }>;
  }>) | ((inputContext: better_call0.MiddlewareInputContext<{
    use: ((inputContext: better_call0.MiddlewareInputContext<better_call0.MiddlewareOptions>) => Promise<{
      session: {
        session: Record<string, any> & {
          id: string;
          createdAt: Date;
          updatedAt: Date;
          userId: string;
          expiresAt: Date;
          token: string;
          ipAddress?: string | null | undefined;
          userAgent?: string | null | undefined;
        };
        user: Record<string, any> & {
          id: string;
          createdAt: Date;
          updatedAt: Date;
          email: string;
          emailVerified: boolean;
          name: string;
          image?: string | null | undefined;
        };
      };
    }>)[];
  }>) => Promise<{
    session: {
      session: {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        userId: string;
        expiresAt: Date;
        token: string;
        ipAddress?: string | null | undefined;
        userAgent?: string | null | undefined;
      } & {
        activeTeamId?: string | undefined;
        activeOrganizationId?: string | undefined;
      };
      user: {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        email: string;
        emailVerified: boolean;
        name: string;
        image?: string | null | undefined;
      };
    };
  }>))[];
  body: z.ZodObject<{
    email: z.ZodString;
    role: z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>]>;
    organizationId: z.ZodOptional<z.ZodString>;
    resend: z.ZodOptional<z.ZodBoolean>;
    teamId: z.ZodUnion<readonly [z.ZodOptional<z.ZodString>, z.ZodOptional<z.ZodArray<z.ZodString>>]>;
  }, z.core.$strip>;
  metadata: {
    $Infer: {
      body: {
        /**
         * The email address of the user
         * to invite
         */
        email: string;
        /**
         * The role to assign to the user
         */
        role: InferOrganizationRolesFromOption<O> | InferOrganizationRolesFromOption<O>[];
        /**
         * The organization ID to invite
         * the user to
         */
        organizationId?: string | undefined;
        /**
         * Resend the invitation email, if
         * the user is already invited
         */
        resend?: boolean | undefined;
      } & (O extends {
        teams: {
          enabled: true;
        };
      } ? {
        /**
         * The team the user is
         * being invited to.
         */
        teamId?: (string | string[]) | undefined;
      } : {}) & InferAdditionalFieldsFromPluginOptions<"invitation", O, false>;
    };
    openapi: {
      operationId: string;
      description: string;
      responses: {
        "200": {
          description: string;
          content: {
            "application/json": {
              schema: {
                type: "object";
                properties: {
                  id: {
                    type: string;
                  };
                  email: {
                    type: string;
                  };
                  role: {
                    type: string;
                  };
                  organizationId: {
                    type: string;
                  };
                  inviterId: {
                    type: string;
                  };
                  status: {
                    type: string;
                  };
                  expiresAt: {
                    type: string;
                  };
                  createdAt: {
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
}, ((O["teams"] extends {
  enabled: true;
} ? {
  id: string;
  organizationId: string;
  email: string;
  role: InferOrganizationRolesFromOption<O>;
  status: InvitationStatus;
  inviterId: string;
  expiresAt: Date;
  createdAt: Date;
  teamId?: string | undefined;
} : {
  id: string;
  organizationId: string;
  email: string;
  role: InferOrganizationRolesFromOption<O>;
  status: InvitationStatus;
  inviterId: string;
  expiresAt: Date;
  createdAt: Date;
}) & (O["schema"] extends {
  invitation?: {
    additionalFields: infer Field extends Record<string, _better_auth_core_db0.DBFieldAttribute>;
  } | undefined;
} ? FieldAttributeToObject<Field> : {}) extends infer T ? { [K in keyof T]: T[K] } : never) | ((O["teams"] extends {
  enabled: true;
} ? {
  id: string;
  organizationId: string;
  email: string;
  role: InferOrganizationRolesFromOption<O>;
  status: InvitationStatus;
  inviterId: string;
  expiresAt: Date;
  createdAt: Date;
  teamId?: string | undefined;
} : {
  id: string;
  organizationId: string;
  email: string;
  role: InferOrganizationRolesFromOption<O>;
  status: InvitationStatus;
  inviterId: string;
  expiresAt: Date;
  createdAt: Date;
}) & (O["schema"] extends {
  invitation?: {
    additionalFields: infer Field extends Record<string, _better_auth_core_db0.DBFieldAttribute>;
  } | undefined;
} ? FieldAttributeToObject<RemoveFieldsWithReturnedFalse<Field>> : {}) extends infer T_1 ? { [K_1 in keyof T_1]: T_1[K_1] } : never)>;
declare const acceptInvitation: <O extends OrganizationOptions>(options: O) => better_call0.StrictEndpoint<"/organization/accept-invitation", {
  method: "POST";
  body: z.ZodObject<{
    invitationId: z.ZodString;
  }, z.core.$strip>;
  requireHeaders: true;
  use: (((inputContext: better_call0.MiddlewareInputContext<better_call0.MiddlewareOptions>) => Promise<{
    orgOptions: OrganizationOptions;
    roles: typeof defaultRoles & {
      [key: string]: Role<{}>;
    };
    getSession: (context: _better_auth_core0.GenericEndpointContext) => Promise<{
      session: {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        userId: string;
        expiresAt: Date;
        token: string;
        ipAddress?: string | null | undefined;
        userAgent?: string | null | undefined;
      } & {
        activeTeamId?: string | undefined;
        activeOrganizationId?: string | undefined;
      };
      user: {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        email: string;
        emailVerified: boolean;
        name: string;
        image?: string | null | undefined;
      };
    }>;
  }>) | ((inputContext: better_call0.MiddlewareInputContext<{
    use: ((inputContext: better_call0.MiddlewareInputContext<better_call0.MiddlewareOptions>) => Promise<{
      session: {
        session: Record<string, any> & {
          id: string;
          createdAt: Date;
          updatedAt: Date;
          userId: string;
          expiresAt: Date;
          token: string;
          ipAddress?: string | null | undefined;
          userAgent?: string | null | undefined;
        };
        user: Record<string, any> & {
          id: string;
          createdAt: Date;
          updatedAt: Date;
          email: string;
          emailVerified: boolean;
          name: string;
          image?: string | null | undefined;
        };
      };
    }>)[];
  }>) => Promise<{
    session: {
      session: {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        userId: string;
        expiresAt: Date;
        token: string;
        ipAddress?: string | null | undefined;
        userAgent?: string | null | undefined;
      } & {
        activeTeamId?: string | undefined;
        activeOrganizationId?: string | undefined;
      };
      user: {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        email: string;
        emailVerified: boolean;
        name: string;
        image?: string | null | undefined;
      };
    };
  }>))[];
  metadata: {
    openapi: {
      description: string;
      responses: {
        "200": {
          description: string;
          content: {
            "application/json": {
              schema: {
                type: "object";
                properties: {
                  invitation: {
                    type: string;
                  };
                  member: {
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
  invitation: (O["teams"] extends {
    enabled: true;
  } ? {
    id: string;
    organizationId: string;
    email: string;
    role: InferOrganizationRolesFromOption<O>;
    status: InvitationStatus;
    inviterId: string;
    expiresAt: Date;
    createdAt: Date;
    teamId?: string | undefined;
  } : {
    id: string;
    organizationId: string;
    email: string;
    role: InferOrganizationRolesFromOption<O>;
    status: InvitationStatus;
    inviterId: string;
    expiresAt: Date;
    createdAt: Date;
  }) & (O["schema"] extends {
    invitation?: {
      additionalFields: infer Field extends Record<string, _better_auth_core_db0.DBFieldAttribute>;
    } | undefined;
  } ? FieldAttributeToObject<Field> : {}) extends infer T ? { [K in keyof T]: T[K] } : never;
  member: {
    id: string;
    organizationId: string;
    userId: string;
    role: string;
    createdAt: Date;
  } & InferAdditionalFieldsFromPluginOptions<"member", O, false>;
}>;
declare const rejectInvitation: <O extends OrganizationOptions>(options: O) => better_call0.StrictEndpoint<"/organization/reject-invitation", {
  method: "POST";
  body: z.ZodObject<{
    invitationId: z.ZodString;
  }, z.core.$strip>;
  requireHeaders: true;
  use: (((inputContext: better_call0.MiddlewareInputContext<better_call0.MiddlewareOptions>) => Promise<{
    orgOptions: OrganizationOptions;
    roles: typeof defaultRoles & {
      [key: string]: Role<{}>;
    };
    getSession: (context: _better_auth_core0.GenericEndpointContext) => Promise<{
      session: {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        userId: string;
        expiresAt: Date;
        token: string;
        ipAddress?: string | null | undefined;
        userAgent?: string | null | undefined;
      } & {
        activeTeamId?: string | undefined;
        activeOrganizationId?: string | undefined;
      };
      user: {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        email: string;
        emailVerified: boolean;
        name: string;
        image?: string | null | undefined;
      };
    }>;
  }>) | ((inputContext: better_call0.MiddlewareInputContext<{
    use: ((inputContext: better_call0.MiddlewareInputContext<better_call0.MiddlewareOptions>) => Promise<{
      session: {
        session: Record<string, any> & {
          id: string;
          createdAt: Date;
          updatedAt: Date;
          userId: string;
          expiresAt: Date;
          token: string;
          ipAddress?: string | null | undefined;
          userAgent?: string | null | undefined;
        };
        user: Record<string, any> & {
          id: string;
          createdAt: Date;
          updatedAt: Date;
          email: string;
          emailVerified: boolean;
          name: string;
          image?: string | null | undefined;
        };
      };
    }>)[];
  }>) => Promise<{
    session: {
      session: {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        userId: string;
        expiresAt: Date;
        token: string;
        ipAddress?: string | null | undefined;
        userAgent?: string | null | undefined;
      } & {
        activeTeamId?: string | undefined;
        activeOrganizationId?: string | undefined;
      };
      user: {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        email: string;
        emailVerified: boolean;
        name: string;
        image?: string | null | undefined;
      };
    };
  }>))[];
  metadata: {
    openapi: {
      description: string;
      responses: {
        "200": {
          description: string;
          content: {
            "application/json": {
              schema: {
                type: "object";
                properties: {
                  invitation: {
                    type: string;
                  };
                  member: {
                    type: string;
                    nullable: boolean;
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
  invitation: {
    id: string;
    organizationId: string;
    email: string;
    role: "admin" | "member" | "owner";
    status: InvitationStatus;
    inviterId: string;
    expiresAt: Date;
    createdAt: Date;
  } | null;
  member: null;
}>;
declare const cancelInvitation: <O extends OrganizationOptions>(options: O) => better_call0.StrictEndpoint<"/organization/cancel-invitation", {
  method: "POST";
  body: z.ZodObject<{
    invitationId: z.ZodString;
  }, z.core.$strip>;
  requireHeaders: true;
  use: (((inputContext: better_call0.MiddlewareInputContext<better_call0.MiddlewareOptions>) => Promise<{
    orgOptions: OrganizationOptions;
    roles: typeof defaultRoles & {
      [key: string]: Role<{}>;
    };
    getSession: (context: _better_auth_core0.GenericEndpointContext) => Promise<{
      session: {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        userId: string;
        expiresAt: Date;
        token: string;
        ipAddress?: string | null | undefined;
        userAgent?: string | null | undefined;
      } & {
        activeTeamId?: string | undefined;
        activeOrganizationId?: string | undefined;
      };
      user: {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        email: string;
        emailVerified: boolean;
        name: string;
        image?: string | null | undefined;
      };
    }>;
  }>) | ((inputContext: better_call0.MiddlewareInputContext<{
    use: ((inputContext: better_call0.MiddlewareInputContext<better_call0.MiddlewareOptions>) => Promise<{
      session: {
        session: Record<string, any> & {
          id: string;
          createdAt: Date;
          updatedAt: Date;
          userId: string;
          expiresAt: Date;
          token: string;
          ipAddress?: string | null | undefined;
          userAgent?: string | null | undefined;
        };
        user: Record<string, any> & {
          id: string;
          createdAt: Date;
          updatedAt: Date;
          email: string;
          emailVerified: boolean;
          name: string;
          image?: string | null | undefined;
        };
      };
    }>)[];
  }>) => Promise<{
    session: {
      session: {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        userId: string;
        expiresAt: Date;
        token: string;
        ipAddress?: string | null | undefined;
        userAgent?: string | null | undefined;
      } & {
        activeTeamId?: string | undefined;
        activeOrganizationId?: string | undefined;
      };
      user: {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        email: string;
        emailVerified: boolean;
        name: string;
        image?: string | null | undefined;
      };
    };
  }>))[];
  openapi: {
    operationId: string;
    description: string;
    responses: {
      "200": {
        description: string;
        content: {
          "application/json": {
            schema: {
              type: string;
              properties: {
                invitation: {
                  type: string;
                };
              };
            };
          };
        };
      };
    };
  };
}, ((O["teams"] extends {
  enabled: true;
} ? {
  id: string;
  organizationId: string;
  email: string;
  role: InferOrganizationRolesFromOption<O>;
  status: InvitationStatus;
  inviterId: string;
  expiresAt: Date;
  createdAt: Date;
  teamId?: string | undefined;
} : {
  id: string;
  organizationId: string;
  email: string;
  role: InferOrganizationRolesFromOption<O>;
  status: InvitationStatus;
  inviterId: string;
  expiresAt: Date;
  createdAt: Date;
}) & (O["schema"] extends {
  invitation?: {
    additionalFields: infer Field extends Record<string, _better_auth_core_db0.DBFieldAttribute>;
  } | undefined;
} ? FieldAttributeToObject<Field> : {}) extends infer T ? { [K in keyof T]: T[K] } : never) | null>;
declare const getInvitation: <O extends OrganizationOptions>(options: O) => better_call0.StrictEndpoint<"/organization/get-invitation", {
  method: "GET";
  use: ((inputContext: better_call0.MiddlewareInputContext<better_call0.MiddlewareOptions>) => Promise<{
    orgOptions: OrganizationOptions;
    roles: typeof defaultRoles & {
      [key: string]: Role<{}>;
    };
    getSession: (context: _better_auth_core0.GenericEndpointContext) => Promise<{
      session: {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        userId: string;
        expiresAt: Date;
        token: string;
        ipAddress?: string | null | undefined;
        userAgent?: string | null | undefined;
      } & {
        activeTeamId?: string | undefined;
        activeOrganizationId?: string | undefined;
      };
      user: {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        email: string;
        emailVerified: boolean;
        name: string;
        image?: string | null | undefined;
      };
    }>;
  }>)[];
  requireHeaders: true;
  query: z.ZodObject<{
    id: z.ZodString;
  }, z.core.$strip>;
  metadata: {
    openapi: {
      description: string;
      responses: {
        "200": {
          description: string;
          content: {
            "application/json": {
              schema: {
                type: "object";
                properties: {
                  id: {
                    type: string;
                  };
                  email: {
                    type: string;
                  };
                  role: {
                    type: string;
                  };
                  organizationId: {
                    type: string;
                  };
                  inviterId: {
                    type: string;
                  };
                  status: {
                    type: string;
                  };
                  expiresAt: {
                    type: string;
                  };
                  organizationName: {
                    type: string;
                  };
                  organizationSlug: {
                    type: string;
                  };
                  inviterEmail: {
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
}, ((O["teams"] extends {
  enabled: true;
} ? {
  id: string;
  organizationId: string;
  email: string;
  role: InferOrganizationRolesFromOption<O>;
  status: InvitationStatus;
  inviterId: string;
  expiresAt: Date;
  createdAt: Date;
  teamId?: string | undefined;
} : {
  id: string;
  organizationId: string;
  email: string;
  role: InferOrganizationRolesFromOption<O>;
  status: InvitationStatus;
  inviterId: string;
  expiresAt: Date;
  createdAt: Date;
}) & (O["schema"] extends {
  invitation?: {
    additionalFields: infer Field extends Record<string, _better_auth_core_db0.DBFieldAttribute>;
  } | undefined;
} ? FieldAttributeToObject<Field> : {}) extends infer T ? { [K in keyof T]: T[K] } : never) & {
  organizationName: ({
    id: string;
    name: string;
    slug: string;
    createdAt: Date;
    logo?: string | null | undefined;
    metadata?: any;
  } & (O["schema"] extends {
    organization?: {
      additionalFields: infer Field extends Record<string, _better_auth_core_db0.DBFieldAttribute>;
    } | undefined;
  } ? FieldAttributeToObject<RemoveFieldsWithReturnedFalse<Field>> : {}))["name"];
  organizationSlug: ({
    id: string;
    name: string;
    slug: string;
    createdAt: Date;
    logo?: string | null | undefined;
    metadata?: any;
  } & (O["schema"] extends {
    organization?: {
      additionalFields: infer Field extends Record<string, _better_auth_core_db0.DBFieldAttribute>;
    } | undefined;
  } ? FieldAttributeToObject<RemoveFieldsWithReturnedFalse<Field>> : {}))["slug"];
  inviterEmail: string;
}>;
declare const listInvitations: <O extends OrganizationOptions>(options: O) => better_call0.StrictEndpoint<"/organization/list-invitations", {
  method: "GET";
  requireHeaders: true;
  use: (((inputContext: better_call0.MiddlewareInputContext<better_call0.MiddlewareOptions>) => Promise<{
    orgOptions: OrganizationOptions;
    roles: typeof defaultRoles & {
      [key: string]: Role<{}>;
    };
    getSession: (context: _better_auth_core0.GenericEndpointContext) => Promise<{
      session: {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        userId: string;
        expiresAt: Date;
        token: string;
        ipAddress?: string | null | undefined;
        userAgent?: string | null | undefined;
      } & {
        activeTeamId?: string | undefined;
        activeOrganizationId?: string | undefined;
      };
      user: {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        email: string;
        emailVerified: boolean;
        name: string;
        image?: string | null | undefined;
      };
    }>;
  }>) | ((inputContext: better_call0.MiddlewareInputContext<{
    use: ((inputContext: better_call0.MiddlewareInputContext<better_call0.MiddlewareOptions>) => Promise<{
      session: {
        session: Record<string, any> & {
          id: string;
          createdAt: Date;
          updatedAt: Date;
          userId: string;
          expiresAt: Date;
          token: string;
          ipAddress?: string | null | undefined;
          userAgent?: string | null | undefined;
        };
        user: Record<string, any> & {
          id: string;
          createdAt: Date;
          updatedAt: Date;
          email: string;
          emailVerified: boolean;
          name: string;
          image?: string | null | undefined;
        };
      };
    }>)[];
  }>) => Promise<{
    session: {
      session: {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        userId: string;
        expiresAt: Date;
        token: string;
        ipAddress?: string | null | undefined;
        userAgent?: string | null | undefined;
      } & {
        activeTeamId?: string | undefined;
        activeOrganizationId?: string | undefined;
      };
      user: {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        email: string;
        emailVerified: boolean;
        name: string;
        image?: string | null | undefined;
      };
    };
  }>))[];
  query: z.ZodOptional<z.ZodObject<{
    organizationId: z.ZodOptional<z.ZodString>;
  }, z.core.$strip>>;
}, ((O["teams"] extends {
  enabled: true;
} ? {
  id: string;
  organizationId: string;
  email: string;
  role: InferOrganizationRolesFromOption<O>;
  status: InvitationStatus;
  inviterId: string;
  expiresAt: Date;
  createdAt: Date;
  teamId?: string | undefined;
} : {
  id: string;
  organizationId: string;
  email: string;
  role: InferOrganizationRolesFromOption<O>;
  status: InvitationStatus;
  inviterId: string;
  expiresAt: Date;
  createdAt: Date;
}) & (O["schema"] extends {
  invitation?: {
    additionalFields: infer Field extends Record<string, _better_auth_core_db0.DBFieldAttribute>;
  } | undefined;
} ? FieldAttributeToObject<Field> : {}) extends infer T ? { [K in keyof T]: T[K] } : never)[]>;
/**
 * List all invitations a user has received
 */
declare const listUserInvitations: <O extends OrganizationOptions>(options: O) => better_call0.StrictEndpoint<"/organization/list-user-invitations", {
  method: "GET";
  use: ((inputContext: better_call0.MiddlewareInputContext<better_call0.MiddlewareOptions>) => Promise<{
    orgOptions: OrganizationOptions;
    roles: typeof defaultRoles & {
      [key: string]: Role<{}>;
    };
    getSession: (context: _better_auth_core0.GenericEndpointContext) => Promise<{
      session: {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        userId: string;
        expiresAt: Date;
        token: string;
        ipAddress?: string | null | undefined;
        userAgent?: string | null | undefined;
      } & {
        activeTeamId?: string | undefined;
        activeOrganizationId?: string | undefined;
      };
      user: {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        email: string;
        emailVerified: boolean;
        name: string;
        image?: string | null | undefined;
      };
    }>;
  }>)[];
  query: z.ZodOptional<z.ZodObject<{
    email: z.ZodOptional<z.ZodString>;
  }, z.core.$strip>>;
  metadata: {
    openapi: {
      description: string;
      responses: {
        "200": {
          description: string;
          content: {
            "application/json": {
              schema: {
                type: "array";
                items: {
                  type: string;
                  properties: {
                    id: {
                      type: string;
                    };
                    email: {
                      type: string;
                    };
                    role: {
                      type: string;
                    };
                    organizationId: {
                      type: string;
                    };
                    organizationName: {
                      type: string;
                    };
                    inviterId: {
                      type: string;
                      description: string;
                    };
                    teamId: {
                      type: string;
                      description: string;
                      nullable: boolean;
                    };
                    status: {
                      type: string;
                    };
                    expiresAt: {
                      type: string;
                    };
                    createdAt: {
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
  };
}, (Omit<((O["teams"] extends {
  enabled: true;
} ? {
  id: string;
  organizationId: string;
  email: string;
  role: InferOrganizationRolesFromOption<O>;
  status: InvitationStatus;
  inviterId: string;
  expiresAt: Date;
  createdAt: Date;
  teamId?: string | undefined;
} : {
  id: string;
  organizationId: string;
  email: string;
  role: InferOrganizationRolesFromOption<O>;
  status: InvitationStatus;
  inviterId: string;
  expiresAt: Date;
  createdAt: Date;
}) & (O["schema"] extends {
  invitation?: {
    additionalFields: infer Field extends Record<string, _better_auth_core_db0.DBFieldAttribute>;
  } | undefined;
} ? FieldAttributeToObject<Field> : {}) extends infer T ? { [K in keyof T]: T[K] } : never) & {
  organization: {
    id: string;
    name: string;
    slug: string;
    createdAt: Date;
    logo?: string | null | undefined;
    metadata?: any;
  } & (O["schema"] extends {
    organization?: {
      additionalFields: infer Field extends Record<string, _better_auth_core_db0.DBFieldAttribute>;
    } | undefined;
  } ? FieldAttributeToObject<Field> : {}) extends infer T_1 ? { [K_1 in keyof T_1]: T_1[K_1] } : never;
}, "organization"> & {
  organizationName: ({
    id: string;
    name: string;
    slug: string;
    createdAt: Date;
    logo?: string | null | undefined;
    metadata?: any;
  } & (O["schema"] extends {
    organization?: {
      additionalFields: infer Field extends Record<string, _better_auth_core_db0.DBFieldAttribute>;
    } | undefined;
  } ? FieldAttributeToObject<Field> : {}))["name"];
})[]>;
//#endregion
export { acceptInvitation, cancelInvitation, createInvitation, getInvitation, listInvitations, listUserInvitations, rejectInvitation };
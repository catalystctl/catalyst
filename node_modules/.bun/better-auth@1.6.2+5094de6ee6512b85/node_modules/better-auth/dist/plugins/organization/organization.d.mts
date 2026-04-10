import { AccessControl, ArrayElement, Statements } from "../access/types.mjs";
import { OrganizationOptions } from "./types.mjs";
import { InferInvitation, InferMember, InferOrganization, InferTeam, OrganizationSchema, Team, TeamMember } from "./schema.mjs";
import { ORGANIZATION_ERROR_CODES } from "./error-codes.mjs";
import { createOrgRole, deleteOrgRole, getOrgRole, listOrgRoles, updateOrgRole } from "./routes/crud-access-control.mjs";
import { acceptInvitation, cancelInvitation, createInvitation, getInvitation, listInvitations, listUserInvitations, rejectInvitation } from "./routes/crud-invites.mjs";
import { addMember, getActiveMember, getActiveMemberRole, leaveOrganization, listMembers, removeMember, updateMemberRole } from "./routes/crud-members.mjs";
import { checkOrganizationSlug, createOrganization, deleteOrganization, getFullOrganization, listOrganizations, setActiveOrganization, updateOrganization } from "./routes/crud-org.mjs";
import { addTeamMember, createTeam, listOrganizationTeams, listTeamMembers, listUserTeams, removeTeam, removeTeamMember, setActiveTeam, updateTeam } from "./routes/crud-team.mjs";
import { hasPermission } from "./has-permission.mjs";
import * as better_call0 from "better-call";
import * as z from "zod";

//#region src/plugins/organization/organization.d.ts
declare module "@better-auth/core" {
  interface BetterAuthPluginRegistry<AuthOptions, Options> {
    organization: {
      creator: OrganizationCreator;
    };
  }
}
type DefaultOrganizationPlugin<Options extends OrganizationOptions> = {
  id: "organization";
  version: string;
  endpoints: OrganizationEndpoints<Options>;
  schema: OrganizationSchema<Options>;
  $Infer: {
    Organization: InferOrganization<Options>;
    Invitation: InferInvitation<Options>;
    Member: InferMember<Options>;
    Team: Options["teams"] extends {
      enabled: true;
    } ? Team : never;
    TeamMember: Options["teams"] extends {
      enabled: true;
    } ? TeamMember : never;
    ActiveOrganization: Options["teams"] extends {
      enabled: true;
    } ? {
      members: InferMember<Options, false>[];
      invitations: InferInvitation<Options, false>[];
      teams: InferTeam<Options, false>[];
    } & InferOrganization<Options, false> : {
      members: InferMember<Options, false>[];
      invitations: InferInvitation<Options, false>[];
    } & InferOrganization<Options, false>;
  };
  $ERROR_CODES: typeof ORGANIZATION_ERROR_CODES;
  options: NoInfer<Options>;
};
interface OrganizationCreator {
  <Options extends OrganizationOptions>(options?: Options | undefined): DefaultOrganizationPlugin<Options>;
}
declare function parseRoles(roles: string | string[]): string;
type DynamicAccessControlEndpoints<O extends OrganizationOptions> = {
  createOrgRole: ReturnType<typeof createOrgRole<O>>;
  deleteOrgRole: ReturnType<typeof deleteOrgRole<O>>;
  listOrgRoles: ReturnType<typeof listOrgRoles<O>>;
  getOrgRole: ReturnType<typeof getOrgRole<O>>;
  updateOrgRole: ReturnType<typeof updateOrgRole<O>>;
};
type TeamEndpoints<O extends OrganizationOptions> = {
  createTeam: ReturnType<typeof createTeam<O>>;
  listOrganizationTeams: ReturnType<typeof listOrganizationTeams<O>>;
  removeTeam: ReturnType<typeof removeTeam<O>>;
  updateTeam: ReturnType<typeof updateTeam<O>>;
  setActiveTeam: ReturnType<typeof setActiveTeam<O>>;
  listUserTeams: ReturnType<typeof listUserTeams<O>>;
  listTeamMembers: ReturnType<typeof listTeamMembers<O>>;
  addTeamMember: ReturnType<typeof addTeamMember<O>>;
  removeTeamMember: ReturnType<typeof removeTeamMember<O>>;
};
type OrganizationEndpoints<O extends OrganizationOptions> = {
  createOrganization: ReturnType<typeof createOrganization<O>>;
  updateOrganization: ReturnType<typeof updateOrganization<O>>;
  deleteOrganization: ReturnType<typeof deleteOrganization<O>>;
  setActiveOrganization: ReturnType<typeof setActiveOrganization<O>>;
  getFullOrganization: ReturnType<typeof getFullOrganization<O>>;
  listOrganizations: ReturnType<typeof listOrganizations<O>>;
  createInvitation: ReturnType<typeof createInvitation<O>>;
  cancelInvitation: ReturnType<typeof cancelInvitation<O>>;
  acceptInvitation: ReturnType<typeof acceptInvitation<O>>;
  getInvitation: ReturnType<typeof getInvitation<O>>;
  rejectInvitation: ReturnType<typeof rejectInvitation<O>>;
  listInvitations: ReturnType<typeof listInvitations<O>>;
  getActiveMember: ReturnType<typeof getActiveMember<O>>;
  checkOrganizationSlug: ReturnType<typeof checkOrganizationSlug<O>>;
  addMember: ReturnType<typeof addMember<O>>;
  removeMember: ReturnType<typeof removeMember<O>>;
  updateMemberRole: ReturnType<typeof updateMemberRole<O>>;
  leaveOrganization: ReturnType<typeof leaveOrganization<O>>;
  listUserInvitations: ReturnType<typeof listUserInvitations<O>>;
  listMembers: ReturnType<typeof listMembers<O>>;
  getActiveMemberRole: ReturnType<typeof getActiveMemberRole<O>>;
  hasPermission: ReturnType<typeof createHasPermission<O>>;
};
declare const createHasPermission: <O extends OrganizationOptions>(options: O) => better_call0.StrictEndpoint<"/organization/has-permission", {
  method: "POST";
  requireHeaders: true;
  body: z.ZodIntersection<z.ZodObject<{
    organizationId: z.ZodOptional<z.ZodString>;
  }, z.core.$strip>, z.ZodUnion<readonly [z.ZodObject<{
    permission: z.ZodRecord<z.ZodString, z.ZodArray<z.ZodString>>;
    permissions: z.ZodUndefined;
  }, z.core.$strip>, z.ZodObject<{
    permission: z.ZodUndefined;
    permissions: z.ZodRecord<z.ZodString, z.ZodArray<z.ZodString>>;
  }, z.core.$strip>]>>;
  use: ((inputContext: better_call0.MiddlewareInputContext<{
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
  }>)[];
  metadata: {
    $Infer: {
      body: {
        permissions: { [key in keyof (O["ac"] extends AccessControl<infer S extends Statements> ? S : {
          readonly organization: readonly ["update", "delete"];
          readonly member: readonly ["create", "update", "delete"];
          readonly invitation: readonly ["create", "cancel"];
          readonly team: readonly ["create", "update", "delete"];
          readonly ac: readonly ["create", "read", "update", "delete"];
        })]?: ((O["ac"] extends AccessControl<infer S extends Statements> ? S : {
          readonly organization: readonly ["update", "delete"];
          readonly member: readonly ["create", "update", "delete"];
          readonly invitation: readonly ["create", "cancel"];
          readonly team: readonly ["create", "update", "delete"];
          readonly ac: readonly ["create", "read", "update", "delete"];
        })[key] extends readonly unknown[] ? ArrayElement<(O["ac"] extends AccessControl<infer S extends Statements> ? S : {
          readonly organization: readonly ["update", "delete"];
          readonly member: readonly ["create", "update", "delete"];
          readonly invitation: readonly ["create", "cancel"];
          readonly team: readonly ["create", "update", "delete"];
          readonly ac: readonly ["create", "read", "update", "delete"];
        })[key]> : never)[] | undefined };
      } & {
        organizationId?: string | undefined;
      };
    };
    openapi: {
      description: string;
      requestBody: {
        content: {
          "application/json": {
            schema: {
              type: "object";
              properties: {
                permission: {
                  type: string;
                  description: string;
                  deprecated: boolean;
                };
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
  };
}, {
  error: null;
  success: boolean;
}>;
type OrganizationPlugin<O extends OrganizationOptions> = {
  id: "organization";
  version: string;
  endpoints: OrganizationEndpoints<O> & (O extends {
    teams: {
      enabled: true;
    };
  } ? TeamEndpoints<O> : {}) & (O extends {
    dynamicAccessControl: {
      enabled: true;
    };
  } ? DynamicAccessControlEndpoints<O> : {});
  schema: OrganizationSchema<O>;
  $Infer: {
    Organization: InferOrganization<O>;
    Invitation: InferInvitation<O>;
    Member: InferMember<O>;
    Team: O["teams"] extends {
      enabled: true;
    } ? Team : never;
    TeamMember: O["teams"] extends {
      enabled: true;
    } ? TeamMember : never;
    ActiveOrganization: O["teams"] extends {
      enabled: true;
    } ? {
      members: InferMember<O, false>[];
      invitations: InferInvitation<O, false>[];
      teams: InferTeam<O, false>[];
    } & InferOrganization<O, false> : {
      members: InferMember<O, false>[];
      invitations: InferInvitation<O, false>[];
    } & InferOrganization<O, false>;
  };
  $ERROR_CODES: typeof ORGANIZATION_ERROR_CODES;
  options: NoInfer<O>;
};
/**
 * Organization plugin for Better Auth. Organization allows you to create teams, members,
 * and manage access control for your users.
 *
 * @example
 * ```ts
 * const auth = betterAuth({
 *  plugins: [
 *    organization({
 *      allowUserToCreateOrganization: true,
 *    }),
 *  ],
 * });
 * ```
 */
declare function organization<O extends OrganizationOptions & {
  teams: {
    enabled: true;
  };
  dynamicAccessControl?: {
    enabled?: false | undefined;
  } | undefined;
}>(options?: O | undefined): {
  id: "organization";
  version: string;
  endpoints: OrganizationEndpoints<O> & TeamEndpoints<O>;
  schema: OrganizationSchema<O>;
  $Infer: {
    Organization: InferOrganization<O>;
    Invitation: InferInvitation<O>;
    Member: InferMember<O>;
    Team: O["teams"] extends {
      enabled: true;
    } ? Team : never;
    TeamMember: O["teams"] extends {
      enabled: true;
    } ? TeamMember : never;
    ActiveOrganization: O["teams"] extends {
      enabled: true;
    } ? {
      members: InferMember<O, false>[];
      invitations: InferInvitation<O, false>[];
      teams: InferTeam<O, false>[];
    } & InferOrganization<O, false> : {
      members: InferMember<O, false>[];
      invitations: InferInvitation<O, false>[];
    } & InferOrganization<O, false>;
  };
  $ERROR_CODES: typeof ORGANIZATION_ERROR_CODES;
  options: NoInfer<O>;
};
declare function organization<O extends OrganizationOptions & {
  teams: {
    enabled: true;
  };
  dynamicAccessControl: {
    enabled: true;
  };
}>(options?: O | undefined): {
  id: "organization";
  version: string;
  endpoints: OrganizationEndpoints<O> & TeamEndpoints<O> & DynamicAccessControlEndpoints<O>;
  schema: OrganizationSchema<O>;
  $Infer: {
    Organization: InferOrganization<O>;
    Invitation: InferInvitation<O>;
    Member: InferMember<O>;
    Team: O["teams"] extends {
      enabled: true;
    } ? Team : never;
    TeamMember: O["teams"] extends {
      enabled: true;
    } ? TeamMember : never;
    ActiveOrganization: O["teams"] extends {
      enabled: true;
    } ? {
      members: InferMember<O, false>[];
      invitations: InferInvitation<O, false>[];
      teams: InferTeam<O, false>[];
    } & InferOrganization<O, false> : {
      members: InferMember<O, false>[];
      invitations: InferInvitation<O, false>[];
    } & InferOrganization<O, false>;
  };
  $ERROR_CODES: typeof ORGANIZATION_ERROR_CODES;
  options: NoInfer<O>;
};
declare function organization<O extends OrganizationOptions & {
  dynamicAccessControl: {
    enabled: true;
  };
  teams?: {
    enabled?: false | undefined;
  } | undefined;
}>(options?: O | undefined): {
  id: "organization";
  version: string;
  endpoints: OrganizationEndpoints<O> & DynamicAccessControlEndpoints<O>;
  schema: OrganizationSchema<O>;
  $Infer: {
    Organization: InferOrganization<O>;
    Invitation: InferInvitation<O>;
    Member: InferMember<O>;
    Team: O["teams"] extends {
      enabled: true;
    } ? Team : never;
    TeamMember: O["teams"] extends {
      enabled: true;
    } ? TeamMember : never;
    ActiveOrganization: O["teams"] extends {
      enabled: true;
    } ? {
      members: InferMember<O, false>[];
      invitations: InferInvitation<O, false>[];
      teams: InferTeam<O, false>[];
    } & InferOrganization<O, false> : {
      members: InferMember<O, false>[];
      invitations: InferInvitation<O, false>[];
    } & InferOrganization<O, false>;
  };
  $ERROR_CODES: typeof ORGANIZATION_ERROR_CODES;
  options: NoInfer<O>;
};
declare function organization<O extends OrganizationOptions>(options?: O | undefined): DefaultOrganizationPlugin<O>;
//#endregion
export { DefaultOrganizationPlugin, DynamicAccessControlEndpoints, OrganizationCreator, OrganizationEndpoints, OrganizationPlugin, TeamEndpoints, organization, parseRoles };
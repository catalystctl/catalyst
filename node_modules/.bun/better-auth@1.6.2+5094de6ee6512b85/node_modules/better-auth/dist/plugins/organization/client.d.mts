import { FieldAttributeToObject, RemoveFieldsWithReturnedFalse } from "../../db/field.mjs";
import { Prettify } from "../../types/helper.mjs";
import { BetterAuthOptions as BetterAuthOptions$1 } from "../../types/index.mjs";
import { AuthQueryAtom } from "../../client/query.mjs";
import { AccessControl, ArrayElement, Role, Statements } from "../access/types.mjs";
import { OrganizationOptions } from "./types.mjs";
import { InferInvitation, InferMember, InferOrganization, InferOrganizationRolesFromOption, InferOrganizationZodRolesFromOption, InferTeam, Invitation, InvitationInput, InvitationStatus, Member, MemberInput, Organization, OrganizationInput, OrganizationRole, OrganizationSchema, Team, TeamInput, TeamMember, TeamMemberInput, defaultRolesSchema, invitationSchema, invitationStatus, memberSchema, organizationRoleSchema, organizationSchema, roleSchema, teamMemberSchema, teamSchema } from "./schema.mjs";
import { ORGANIZATION_ERROR_CODES } from "./error-codes.mjs";
import { HasPermissionBaseInput } from "./permission.mjs";
import { OrganizationPlugin } from "./organization.mjs";
import * as _better_auth_core0 from "@better-auth/core";
import { DBFieldAttribute } from "@better-auth/core/db";
import * as _better_auth_core_utils_error_codes0 from "@better-auth/core/utils/error-codes";
import * as nanostores from "nanostores";
import * as _better_fetch_fetch0 from "@better-fetch/fetch";

//#region src/plugins/organization/client.d.ts
/**
 * Using the same `hasPermissionFn` function, but without the need for a `ctx` parameter or the `organizationId` parameter.
 */
declare const clientSideHasPermission: (input: HasPermissionBaseInput) => boolean;
interface OrganizationClientOptions {
  ac?: AccessControl | undefined;
  roles?: { [key in string]: Role } | undefined;
  teams?: {
    enabled: boolean;
  } | undefined;
  schema?: {
    organization?: {
      additionalFields?: {
        [key: string]: DBFieldAttribute;
      };
    };
    member?: {
      additionalFields?: {
        [key: string]: DBFieldAttribute;
      };
    };
    invitation?: {
      additionalFields?: {
        [key: string]: DBFieldAttribute;
      };
    };
    team?: {
      additionalFields?: {
        [key: string]: DBFieldAttribute;
      };
    };
    organizationRole?: {
      additionalFields?: {
        [key: string]: DBFieldAttribute;
      };
    };
  } | undefined;
  dynamicAccessControl?: {
    enabled: boolean;
  } | undefined;
}
declare const organizationClient: <CO extends OrganizationClientOptions>(options?: CO | undefined) => {
  id: "organization";
  version: string;
  $InferServerPlugin: OrganizationPlugin<{
    ac: CO["ac"] extends AccessControl ? CO["ac"] : AccessControl<{
      readonly organization: readonly ["update", "delete"];
      readonly member: readonly ["create", "update", "delete"];
      readonly invitation: readonly ["create", "cancel"];
      readonly team: readonly ["create", "update", "delete"];
      readonly ac: readonly ["create", "read", "update", "delete"];
    }>;
    roles: CO["roles"] extends Record<string, Role> ? CO["roles"] : {
      admin: Role;
      member: Role;
      owner: Role;
    };
    teams: {
      enabled: CO["teams"] extends {
        enabled: true;
      } ? true : false;
    };
    schema: CO["schema"];
    dynamicAccessControl: {
      enabled: CO["dynamicAccessControl"] extends {
        enabled: true;
      } ? true : false;
    };
  }>;
  getActions: ($fetch: _better_fetch_fetch0.BetterFetch, _$store: _better_auth_core0.ClientStore, co: _better_auth_core0.BetterAuthClientOptions | undefined) => {
    $Infer: {
      ActiveOrganization: CO["teams"] extends {
        enabled: true;
      } ? {
        members: InferMember<CO>[];
        invitations: InferInvitation<CO>[];
        teams: InferTeam<CO>[];
      } & ({
        id: string;
        name: string;
        slug: string;
        createdAt: Date;
        logo?: string | null | undefined;
        metadata?: any;
      } & (CO["schema"] extends {
        organization?: {
          additionalFields: infer Field extends Record<string, DBFieldAttribute>;
        } | undefined;
      } ? FieldAttributeToObject<RemoveFieldsWithReturnedFalse<Field>> : {}) extends infer T ? { [K in keyof T]: T[K] } : never) : {
        members: InferMember<CO>[];
        invitations: InferInvitation<CO>[];
      } & ({
        id: string;
        name: string;
        slug: string;
        createdAt: Date;
        logo?: string | null | undefined;
        metadata?: any;
      } & (CO["schema"] extends {
        organization?: {
          additionalFields: infer Field extends Record<string, DBFieldAttribute>;
        } | undefined;
      } ? FieldAttributeToObject<RemoveFieldsWithReturnedFalse<Field>> : {}) extends infer T_1 ? { [K in keyof T_1]: T_1[K] } : never);
      Organization: InferOrganization<CO>;
      Invitation: InferInvitation<CO>;
      Member: InferMember<CO>;
      Team: InferTeam<CO>;
    };
    organization: {
      checkRolePermission: <R extends (CO extends {
        roles: any;
      } ? keyof CO["roles"] : "admin" | "member" | "owner")>(data: {
        permissions: { [key in keyof (CO["ac"] extends AccessControl<infer S extends Statements> ? S : {
          readonly organization: readonly ["update", "delete"];
          readonly member: readonly ["create", "update", "delete"];
          readonly invitation: readonly ["create", "cancel"];
          readonly team: readonly ["create", "update", "delete"];
          readonly ac: readonly ["create", "read", "update", "delete"];
        })]?: ((CO["ac"] extends AccessControl<infer S extends Statements> ? S : {
          readonly organization: readonly ["update", "delete"];
          readonly member: readonly ["create", "update", "delete"];
          readonly invitation: readonly ["create", "cancel"];
          readonly team: readonly ["create", "update", "delete"];
          readonly ac: readonly ["create", "read", "update", "delete"];
        })[key] extends readonly unknown[] ? ArrayElement<(CO["ac"] extends AccessControl<infer S extends Statements> ? S : {
          readonly organization: readonly ["update", "delete"];
          readonly member: readonly ["create", "update", "delete"];
          readonly invitation: readonly ["create", "cancel"];
          readonly team: readonly ["create", "update", "delete"];
          readonly ac: readonly ["create", "read", "update", "delete"];
        })[key]> : never)[] | undefined };
      } & {
        role: R;
      }) => boolean;
    };
  };
  getAtoms: ($fetch: _better_fetch_fetch0.BetterFetch) => {
    $listOrg: nanostores.PreinitializedWritableAtom<boolean> & object;
    $activeOrgSignal: nanostores.PreinitializedWritableAtom<boolean> & object;
    $activeMemberSignal: nanostores.PreinitializedWritableAtom<boolean> & object;
    $activeMemberRoleSignal: nanostores.PreinitializedWritableAtom<boolean> & object;
    activeOrganization: AuthQueryAtom<Prettify<({
      id: string;
      name: string;
      slug: string;
      createdAt: Date;
      logo?: string | null | undefined;
      metadata?: any;
    } & (CO["schema"] extends {
      organization?: {
        additionalFields: infer Field extends Record<string, DBFieldAttribute>;
      } | undefined;
    } ? FieldAttributeToObject<RemoveFieldsWithReturnedFalse<Field>> : {}) extends infer T ? { [K in keyof T]: T[K] } : never) & {
      members: InferMember<CO>[];
      invitations: InferInvitation<CO>[];
    }>>;
    listOrganizations: AuthQueryAtom<({
      id: string;
      name: string;
      slug: string;
      createdAt: Date;
      logo?: string | null | undefined;
      metadata?: any;
    } & (CO["schema"] extends {
      organization?: {
        additionalFields: infer Field extends Record<string, DBFieldAttribute>;
      } | undefined;
    } ? FieldAttributeToObject<RemoveFieldsWithReturnedFalse<Field>> : {}) extends infer T_1 ? { [K in keyof T_1]: T_1[K] } : never)[]>;
    activeMember: AuthQueryAtom<{
      id: string;
      organizationId: string;
      userId: string;
      role: string;
      createdAt: Date;
    }>;
    activeMemberRole: AuthQueryAtom<{
      role: string;
    }>;
  };
  pathMethods: {
    "/organization/get-full-organization": "GET";
    "/organization/list-user-teams": "GET";
  };
  atomListeners: ({
    matcher(path: string): path is "/organization/create" | "/organization/update" | "/organization/delete";
    signal: "$listOrg";
  } | {
    matcher(path: string): boolean;
    signal: "$activeOrgSignal";
  } | {
    matcher(path: string): boolean;
    signal: "$sessionSignal";
  } | {
    matcher(path: string): boolean;
    signal: "$activeMemberSignal";
  } | {
    matcher(path: string): boolean;
    signal: "$activeMemberRoleSignal";
  })[];
  $ERROR_CODES: {
    YOU_ARE_NOT_ALLOWED_TO_CREATE_A_NEW_ORGANIZATION: _better_auth_core_utils_error_codes0.RawError<"YOU_ARE_NOT_ALLOWED_TO_CREATE_A_NEW_ORGANIZATION">;
    YOU_HAVE_REACHED_THE_MAXIMUM_NUMBER_OF_ORGANIZATIONS: _better_auth_core_utils_error_codes0.RawError<"YOU_HAVE_REACHED_THE_MAXIMUM_NUMBER_OF_ORGANIZATIONS">;
    ORGANIZATION_ALREADY_EXISTS: _better_auth_core_utils_error_codes0.RawError<"ORGANIZATION_ALREADY_EXISTS">;
    ORGANIZATION_SLUG_ALREADY_TAKEN: _better_auth_core_utils_error_codes0.RawError<"ORGANIZATION_SLUG_ALREADY_TAKEN">;
    ORGANIZATION_NOT_FOUND: _better_auth_core_utils_error_codes0.RawError<"ORGANIZATION_NOT_FOUND">;
    USER_IS_NOT_A_MEMBER_OF_THE_ORGANIZATION: _better_auth_core_utils_error_codes0.RawError<"USER_IS_NOT_A_MEMBER_OF_THE_ORGANIZATION">;
    YOU_ARE_NOT_ALLOWED_TO_UPDATE_THIS_ORGANIZATION: _better_auth_core_utils_error_codes0.RawError<"YOU_ARE_NOT_ALLOWED_TO_UPDATE_THIS_ORGANIZATION">;
    YOU_ARE_NOT_ALLOWED_TO_DELETE_THIS_ORGANIZATION: _better_auth_core_utils_error_codes0.RawError<"YOU_ARE_NOT_ALLOWED_TO_DELETE_THIS_ORGANIZATION">;
    NO_ACTIVE_ORGANIZATION: _better_auth_core_utils_error_codes0.RawError<"NO_ACTIVE_ORGANIZATION">;
    USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION: _better_auth_core_utils_error_codes0.RawError<"USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION">;
    MEMBER_NOT_FOUND: _better_auth_core_utils_error_codes0.RawError<"MEMBER_NOT_FOUND">;
    ROLE_NOT_FOUND: _better_auth_core_utils_error_codes0.RawError<"ROLE_NOT_FOUND">;
    YOU_ARE_NOT_ALLOWED_TO_CREATE_A_NEW_TEAM: _better_auth_core_utils_error_codes0.RawError<"YOU_ARE_NOT_ALLOWED_TO_CREATE_A_NEW_TEAM">;
    TEAM_ALREADY_EXISTS: _better_auth_core_utils_error_codes0.RawError<"TEAM_ALREADY_EXISTS">;
    TEAM_NOT_FOUND: _better_auth_core_utils_error_codes0.RawError<"TEAM_NOT_FOUND">;
    YOU_CANNOT_LEAVE_THE_ORGANIZATION_AS_THE_ONLY_OWNER: _better_auth_core_utils_error_codes0.RawError<"YOU_CANNOT_LEAVE_THE_ORGANIZATION_AS_THE_ONLY_OWNER">;
    YOU_CANNOT_LEAVE_THE_ORGANIZATION_WITHOUT_AN_OWNER: _better_auth_core_utils_error_codes0.RawError<"YOU_CANNOT_LEAVE_THE_ORGANIZATION_WITHOUT_AN_OWNER">;
    YOU_ARE_NOT_ALLOWED_TO_DELETE_THIS_MEMBER: _better_auth_core_utils_error_codes0.RawError<"YOU_ARE_NOT_ALLOWED_TO_DELETE_THIS_MEMBER">;
    YOU_ARE_NOT_ALLOWED_TO_INVITE_USERS_TO_THIS_ORGANIZATION: _better_auth_core_utils_error_codes0.RawError<"YOU_ARE_NOT_ALLOWED_TO_INVITE_USERS_TO_THIS_ORGANIZATION">;
    USER_IS_ALREADY_INVITED_TO_THIS_ORGANIZATION: _better_auth_core_utils_error_codes0.RawError<"USER_IS_ALREADY_INVITED_TO_THIS_ORGANIZATION">;
    INVITATION_NOT_FOUND: _better_auth_core_utils_error_codes0.RawError<"INVITATION_NOT_FOUND">;
    YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION: _better_auth_core_utils_error_codes0.RawError<"YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION">;
    EMAIL_VERIFICATION_REQUIRED_BEFORE_ACCEPTING_OR_REJECTING_INVITATION: _better_auth_core_utils_error_codes0.RawError<"EMAIL_VERIFICATION_REQUIRED_BEFORE_ACCEPTING_OR_REJECTING_INVITATION">;
    YOU_ARE_NOT_ALLOWED_TO_CANCEL_THIS_INVITATION: _better_auth_core_utils_error_codes0.RawError<"YOU_ARE_NOT_ALLOWED_TO_CANCEL_THIS_INVITATION">;
    INVITER_IS_NO_LONGER_A_MEMBER_OF_THE_ORGANIZATION: _better_auth_core_utils_error_codes0.RawError<"INVITER_IS_NO_LONGER_A_MEMBER_OF_THE_ORGANIZATION">;
    YOU_ARE_NOT_ALLOWED_TO_INVITE_USER_WITH_THIS_ROLE: _better_auth_core_utils_error_codes0.RawError<"YOU_ARE_NOT_ALLOWED_TO_INVITE_USER_WITH_THIS_ROLE">;
    FAILED_TO_RETRIEVE_INVITATION: _better_auth_core_utils_error_codes0.RawError<"FAILED_TO_RETRIEVE_INVITATION">;
    YOU_HAVE_REACHED_THE_MAXIMUM_NUMBER_OF_TEAMS: _better_auth_core_utils_error_codes0.RawError<"YOU_HAVE_REACHED_THE_MAXIMUM_NUMBER_OF_TEAMS">;
    UNABLE_TO_REMOVE_LAST_TEAM: _better_auth_core_utils_error_codes0.RawError<"UNABLE_TO_REMOVE_LAST_TEAM">;
    YOU_ARE_NOT_ALLOWED_TO_UPDATE_THIS_MEMBER: _better_auth_core_utils_error_codes0.RawError<"YOU_ARE_NOT_ALLOWED_TO_UPDATE_THIS_MEMBER">;
    ORGANIZATION_MEMBERSHIP_LIMIT_REACHED: _better_auth_core_utils_error_codes0.RawError<"ORGANIZATION_MEMBERSHIP_LIMIT_REACHED">;
    YOU_ARE_NOT_ALLOWED_TO_CREATE_TEAMS_IN_THIS_ORGANIZATION: _better_auth_core_utils_error_codes0.RawError<"YOU_ARE_NOT_ALLOWED_TO_CREATE_TEAMS_IN_THIS_ORGANIZATION">;
    YOU_ARE_NOT_ALLOWED_TO_DELETE_TEAMS_IN_THIS_ORGANIZATION: _better_auth_core_utils_error_codes0.RawError<"YOU_ARE_NOT_ALLOWED_TO_DELETE_TEAMS_IN_THIS_ORGANIZATION">;
    YOU_ARE_NOT_ALLOWED_TO_UPDATE_THIS_TEAM: _better_auth_core_utils_error_codes0.RawError<"YOU_ARE_NOT_ALLOWED_TO_UPDATE_THIS_TEAM">;
    YOU_ARE_NOT_ALLOWED_TO_DELETE_THIS_TEAM: _better_auth_core_utils_error_codes0.RawError<"YOU_ARE_NOT_ALLOWED_TO_DELETE_THIS_TEAM">;
    INVITATION_LIMIT_REACHED: _better_auth_core_utils_error_codes0.RawError<"INVITATION_LIMIT_REACHED">;
    TEAM_MEMBER_LIMIT_REACHED: _better_auth_core_utils_error_codes0.RawError<"TEAM_MEMBER_LIMIT_REACHED">;
    USER_IS_NOT_A_MEMBER_OF_THE_TEAM: _better_auth_core_utils_error_codes0.RawError<"USER_IS_NOT_A_MEMBER_OF_THE_TEAM">;
    YOU_CAN_NOT_ACCESS_THE_MEMBERS_OF_THIS_TEAM: _better_auth_core_utils_error_codes0.RawError<"YOU_CAN_NOT_ACCESS_THE_MEMBERS_OF_THIS_TEAM">;
    YOU_DO_NOT_HAVE_AN_ACTIVE_TEAM: _better_auth_core_utils_error_codes0.RawError<"YOU_DO_NOT_HAVE_AN_ACTIVE_TEAM">;
    YOU_ARE_NOT_ALLOWED_TO_CREATE_A_NEW_TEAM_MEMBER: _better_auth_core_utils_error_codes0.RawError<"YOU_ARE_NOT_ALLOWED_TO_CREATE_A_NEW_TEAM_MEMBER">;
    YOU_ARE_NOT_ALLOWED_TO_REMOVE_A_TEAM_MEMBER: _better_auth_core_utils_error_codes0.RawError<"YOU_ARE_NOT_ALLOWED_TO_REMOVE_A_TEAM_MEMBER">;
    YOU_ARE_NOT_ALLOWED_TO_ACCESS_THIS_ORGANIZATION: _better_auth_core_utils_error_codes0.RawError<"YOU_ARE_NOT_ALLOWED_TO_ACCESS_THIS_ORGANIZATION">;
    YOU_ARE_NOT_A_MEMBER_OF_THIS_ORGANIZATION: _better_auth_core_utils_error_codes0.RawError<"YOU_ARE_NOT_A_MEMBER_OF_THIS_ORGANIZATION">;
    MISSING_AC_INSTANCE: _better_auth_core_utils_error_codes0.RawError<"MISSING_AC_INSTANCE">;
    YOU_MUST_BE_IN_AN_ORGANIZATION_TO_CREATE_A_ROLE: _better_auth_core_utils_error_codes0.RawError<"YOU_MUST_BE_IN_AN_ORGANIZATION_TO_CREATE_A_ROLE">;
    YOU_ARE_NOT_ALLOWED_TO_CREATE_A_ROLE: _better_auth_core_utils_error_codes0.RawError<"YOU_ARE_NOT_ALLOWED_TO_CREATE_A_ROLE">;
    YOU_ARE_NOT_ALLOWED_TO_UPDATE_A_ROLE: _better_auth_core_utils_error_codes0.RawError<"YOU_ARE_NOT_ALLOWED_TO_UPDATE_A_ROLE">;
    YOU_ARE_NOT_ALLOWED_TO_DELETE_A_ROLE: _better_auth_core_utils_error_codes0.RawError<"YOU_ARE_NOT_ALLOWED_TO_DELETE_A_ROLE">;
    YOU_ARE_NOT_ALLOWED_TO_READ_A_ROLE: _better_auth_core_utils_error_codes0.RawError<"YOU_ARE_NOT_ALLOWED_TO_READ_A_ROLE">;
    YOU_ARE_NOT_ALLOWED_TO_LIST_A_ROLE: _better_auth_core_utils_error_codes0.RawError<"YOU_ARE_NOT_ALLOWED_TO_LIST_A_ROLE">;
    YOU_ARE_NOT_ALLOWED_TO_GET_A_ROLE: _better_auth_core_utils_error_codes0.RawError<"YOU_ARE_NOT_ALLOWED_TO_GET_A_ROLE">;
    TOO_MANY_ROLES: _better_auth_core_utils_error_codes0.RawError<"TOO_MANY_ROLES">;
    INVALID_RESOURCE: _better_auth_core_utils_error_codes0.RawError<"INVALID_RESOURCE">;
    ROLE_NAME_IS_ALREADY_TAKEN: _better_auth_core_utils_error_codes0.RawError<"ROLE_NAME_IS_ALREADY_TAKEN">;
    CANNOT_DELETE_A_PRE_DEFINED_ROLE: _better_auth_core_utils_error_codes0.RawError<"CANNOT_DELETE_A_PRE_DEFINED_ROLE">;
    ROLE_IS_ASSIGNED_TO_MEMBERS: _better_auth_core_utils_error_codes0.RawError<"ROLE_IS_ASSIGNED_TO_MEMBERS">;
  };
};
declare const inferOrgAdditionalFields: <O extends {
  options: BetterAuthOptions$1;
}, S extends OrganizationOptions["schema"] = undefined>(schema?: S | undefined) => undefined extends S ? O extends Object ? O extends {
  session?: {
    fields?: {
      activeOrganizationId?: string;
      activeTeamId?: string;
    };
  };
  organization?: {
    modelName?: string;
    fields?: { [key in keyof Omit<Organization, "id">]?: string };
    additionalFields?: { [key in string]: DBFieldAttribute };
  };
  member?: {
    modelName?: string;
    fields?: { [key in keyof Omit<Member, "id">]?: string };
    additionalFields?: { [key in string]: DBFieldAttribute };
  };
  invitation?: {
    modelName?: string;
    fields?: { [key in keyof Omit<Invitation, "id">]?: string };
    additionalFields?: { [key in string]: DBFieldAttribute };
  };
  team?: {
    modelName?: string;
    fields?: { [key in keyof Omit<Team, "id">]?: string };
    additionalFields?: { [key in string]: DBFieldAttribute };
  };
  teamMember?: {
    modelName?: string;
    fields?: { [key in keyof Omit<TeamMember, "id">]?: string };
  };
  organizationRole?: {
    modelName?: string;
    fields?: { [key in keyof Omit<OrganizationRole, "id">]?: string };
    additionalFields?: { [key in string]: DBFieldAttribute };
  };
} ? O : ((O extends {
  options: any;
} ? O : {
  options: {
    plugins: [];
  };
})["options"]["plugins"][number] extends infer T ? T extends (O extends {
  options: any;
} ? O : {
  options: {
    plugins: [];
  };
})["options"]["plugins"][number] ? T extends {
  id: "organization";
} ? T : never : never : never) extends {
  options: {
    schema: infer S_1;
  };
} ? S_1 extends {
  session?: {
    fields?: {
      activeOrganizationId?: string;
      activeTeamId?: string;
    };
  };
  organization?: {
    modelName?: string;
    fields?: { [key in keyof Omit<Organization, "id">]?: string };
    additionalFields?: { [key in string]: DBFieldAttribute };
  };
  member?: {
    modelName?: string;
    fields?: { [key in keyof Omit<Member, "id">]?: string };
    additionalFields?: { [key in string]: DBFieldAttribute };
  };
  invitation?: {
    modelName?: string;
    fields?: { [key in keyof Omit<Invitation, "id">]?: string };
    additionalFields?: { [key in string]: DBFieldAttribute };
  };
  team?: {
    modelName?: string;
    fields?: { [key in keyof Omit<Team, "id">]?: string };
    additionalFields?: { [key in string]: DBFieldAttribute };
  };
  teamMember?: {
    modelName?: string;
    fields?: { [key in keyof Omit<TeamMember, "id">]?: string };
  };
  organizationRole?: {
    modelName?: string;
    fields?: { [key in keyof Omit<OrganizationRole, "id">]?: string };
    additionalFields?: { [key in string]: DBFieldAttribute };
  };
} | undefined ? { [K in keyof S_1 as S_1[K] extends {
  additionalFields: unknown;
} ? K : never]: S_1[K] } : undefined : undefined : undefined : S;
//#endregion
export { clientSideHasPermission, inferOrgAdditionalFields, organizationClient };
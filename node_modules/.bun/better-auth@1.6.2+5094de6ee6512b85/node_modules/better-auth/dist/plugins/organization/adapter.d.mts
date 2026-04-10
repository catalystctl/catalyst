import { FieldAttributeToObject, InferAdditionalFieldsFromPluginOptions, RemoveFieldsWithReturnedFalse } from "../../db/field.mjs";
import { User as User$1 } from "../../types/models.mjs";
import { OrganizationOptions } from "./types.mjs";
import { InferInvitation, InferMember, InferOrganization, InferOrganizationRolesFromOption, InferTeam, InvitationStatus, MemberInput, OrganizationInput, TeamInput, TeamMember } from "./schema.mjs";
import { AuthContext, GenericEndpointContext } from "@better-auth/core";
import * as _better_auth_core_db0 from "@better-auth/core/db";
import { WhereOperator } from "@better-auth/core/db/adapter";

//#region src/plugins/organization/adapter.d.ts
declare const getOrgAdapter: <O extends OrganizationOptions>(context: AuthContext, options?: O | undefined) => {
  findOrganizationBySlug: (slug: string) => Promise<InferOrganization<O> | null>;
  createOrganization: (data: {
    organization: OrganizationInput & Record<string, any>;
  }) => Promise<InferOrganization<O>>;
  findMemberByEmail: (data: {
    email: string;
    organizationId: string;
  }) => Promise<(((O["teams"] extends {
    enabled: true;
  } ? {
    id: string;
    organizationId: string;
    role: InferOrganizationRolesFromOption<O>;
    createdAt: Date;
    userId: string;
    teamId?: string | undefined;
    user: {
      id: string;
      email: string;
      name: string;
      image?: string | undefined;
    };
  } : {
    id: string;
    organizationId: string;
    role: InferOrganizationRolesFromOption<O>;
    createdAt: Date;
    userId: string;
    user: {
      id: string;
      email: string;
      name: string;
      image?: string | undefined;
    };
  }) & (O["schema"] extends {
    member?: {
      additionalFields: infer Field extends Record<string, _better_auth_core_db0.DBFieldAttribute>;
    } | undefined;
  } ? FieldAttributeToObject<Field> : {}) extends infer T ? { [K in keyof T]: T[K] } : never) & {
    user: {
      id: string;
      name: string;
      email: string;
      image: string | null | undefined;
    };
  }) | null>;
  listMembers: (data: {
    organizationId?: string | undefined;
    limit?: number | undefined;
    offset?: number | undefined;
    sortBy?: string | undefined;
    sortOrder?: ("asc" | "desc") | undefined;
    filter?: {
      field: string;
      operator?: WhereOperator;
      value: any;
    } | undefined;
  }) => Promise<{
    members: (((O["teams"] extends {
      enabled: true;
    } ? {
      id: string;
      organizationId: string;
      role: InferOrganizationRolesFromOption<O>;
      createdAt: Date;
      userId: string;
      teamId?: string | undefined;
      user: {
        id: string;
        email: string;
        name: string;
        image?: string | undefined;
      };
    } : {
      id: string;
      organizationId: string;
      role: InferOrganizationRolesFromOption<O>;
      createdAt: Date;
      userId: string;
      user: {
        id: string;
        email: string;
        name: string;
        image?: string | undefined;
      };
    }) & (O["schema"] extends {
      member?: {
        additionalFields: infer Field extends Record<string, _better_auth_core_db0.DBFieldAttribute>;
      } | undefined;
    } ? FieldAttributeToObject<Field> : {}) extends infer T ? { [K in keyof T]: T[K] } : never) & {
      user: {
        id: string;
        name: string;
        email: string;
        image: string | null | undefined;
      };
    })[];
    total: number;
  }>;
  findMemberByOrgId: (data: {
    userId: string;
    organizationId: string;
  }) => Promise<(Omit<((O["teams"] extends {
    enabled: true;
  } ? {
    id: string;
    organizationId: string;
    role: InferOrganizationRolesFromOption<O>;
    createdAt: Date;
    userId: string;
    teamId?: string | undefined;
    user: {
      id: string;
      email: string;
      name: string;
      image?: string | undefined;
    };
  } : {
    id: string;
    organizationId: string;
    role: InferOrganizationRolesFromOption<O>;
    createdAt: Date;
    userId: string;
    user: {
      id: string;
      email: string;
      name: string;
      image?: string | undefined;
    };
  }) & (O["schema"] extends {
    member?: {
      additionalFields: infer Field extends Record<string, _better_auth_core_db0.DBFieldAttribute>;
    } | undefined;
  } ? FieldAttributeToObject<Field> : {}) extends infer T ? { [K in keyof T]: T[K] } : never) & {
    user: User$1;
  }, "user"> & {
    user: {
      id: string;
      name: string;
      email: string;
      image: string | undefined;
    };
  }) | null>;
  findMemberById: (memberId: string) => Promise<(((O["teams"] extends {
    enabled: true;
  } ? {
    id: string;
    organizationId: string;
    role: InferOrganizationRolesFromOption<O>;
    createdAt: Date;
    userId: string;
    teamId?: string | undefined;
    user: {
      id: string;
      email: string;
      name: string;
      image?: string | undefined;
    };
  } : {
    id: string;
    organizationId: string;
    role: InferOrganizationRolesFromOption<O>;
    createdAt: Date;
    userId: string;
    user: {
      id: string;
      email: string;
      name: string;
      image?: string | undefined;
    };
  }) & (O["schema"] extends {
    member?: {
      additionalFields: infer Field extends Record<string, _better_auth_core_db0.DBFieldAttribute>;
    } | undefined;
  } ? FieldAttributeToObject<Field> : {}) extends infer T ? { [K in keyof T]: T[K] } : never) & {
    user: {
      id: string;
      name: string;
      email: string;
      image: string | undefined;
    };
  }) | null>;
  createMember: (data: Omit<MemberInput, "id"> & Record<string, any>) => Promise<{
    id: string;
    organizationId: string;
    userId: string;
    role: string;
    createdAt: Date;
  } & InferAdditionalFieldsFromPluginOptions<"member", O, false>>;
  updateMember: (memberId: string, role: string) => Promise<((O["teams"] extends {
    enabled: true;
  } ? {
    id: string;
    organizationId: string;
    role: InferOrganizationRolesFromOption<O>;
    createdAt: Date;
    userId: string;
    teamId?: string | undefined;
    user: {
      id: string;
      email: string;
      name: string;
      image?: string | undefined;
    };
  } : {
    id: string;
    organizationId: string;
    role: InferOrganizationRolesFromOption<O>;
    createdAt: Date;
    userId: string;
    user: {
      id: string;
      email: string;
      name: string;
      image?: string | undefined;
    };
  }) & (O["schema"] extends {
    member?: {
      additionalFields: infer Field extends Record<string, _better_auth_core_db0.DBFieldAttribute>;
    } | undefined;
  } ? FieldAttributeToObject<Field> : {}) extends infer T ? { [K in keyof T]: T[K] } : never) | null>;
  deleteMember: ({
    memberId,
    organizationId,
    userId: _userId
  }: {
    memberId: string;
    organizationId: string;
    userId?: string;
  }) => Promise<void>;
  updateOrganization: (organizationId: string, data: Partial<OrganizationInput>) => Promise<InferOrganization<O> | null>;
  deleteOrganization: (organizationId: string) => Promise<string>;
  setActiveOrganization: (sessionToken: string, organizationId: string | null, ctx: GenericEndpointContext) => Promise<{
    id: string;
    createdAt: Date;
    updatedAt: Date;
    userId: string;
    expiresAt: Date;
    token: string;
    ipAddress?: string | null | undefined;
    userAgent?: string | null | undefined;
  }>;
  findOrganizationById: (organizationId: string) => Promise<InferOrganization<O> | null>;
  checkMembership: ({
    userId,
    organizationId
  }: {
    userId: string;
    organizationId: string;
  }) => Promise<((O["teams"] extends {
    enabled: true;
  } ? {
    id: string;
    organizationId: string;
    role: InferOrganizationRolesFromOption<O>;
    createdAt: Date;
    userId: string;
    teamId?: string | undefined;
    user: {
      id: string;
      email: string;
      name: string;
      image?: string | undefined;
    };
  } : {
    id: string;
    organizationId: string;
    role: InferOrganizationRolesFromOption<O>;
    createdAt: Date;
    userId: string;
    user: {
      id: string;
      email: string;
      name: string;
      image?: string | undefined;
    };
  }) & (O["schema"] extends {
    member?: {
      additionalFields: infer Field extends Record<string, _better_auth_core_db0.DBFieldAttribute>;
    } | undefined;
  } ? FieldAttributeToObject<Field> : {}) extends infer T ? { [K in keyof T]: T[K] } : never) | null>;
  /**
   * @requires db
   */
  findFullOrganization: ({
    organizationId,
    isSlug,
    includeTeams,
    membersLimit
  }: {
    organizationId: string;
    isSlug?: boolean | undefined;
    includeTeams?: boolean | undefined;
    membersLimit?: number | undefined;
  }) => Promise<(Omit<({
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
  } ? FieldAttributeToObject<Field> : {}) extends infer T ? { [K in keyof T]: T[K] } : never) & {
    invitation: InferInvitation<O>[];
    member: InferMember<O>[];
    team: InferTeam<O>[] | undefined;
  }, "member" | "team" | "invitation"> & {
    invitations: ((O["teams"] extends {
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
    } ? FieldAttributeToObject<RemoveFieldsWithReturnedFalse<Field>> : {}) extends infer T_1 ? { [K_1 in keyof T_1]: T_1[K_1] } : never)[];
    members: (((O["teams"] extends {
      enabled: true;
    } ? {
      id: string;
      organizationId: string;
      role: InferOrganizationRolesFromOption<O>;
      createdAt: Date;
      userId: string;
      teamId?: string | undefined;
      user: {
        id: string;
        email: string;
        name: string;
        image?: string | undefined;
      };
    } : {
      id: string;
      organizationId: string;
      role: InferOrganizationRolesFromOption<O>;
      createdAt: Date;
      userId: string;
      user: {
        id: string;
        email: string;
        name: string;
        image?: string | undefined;
      };
    }) & (O["schema"] extends {
      member?: {
        additionalFields: infer Field extends Record<string, _better_auth_core_db0.DBFieldAttribute>;
      } | undefined;
    } ? FieldAttributeToObject<RemoveFieldsWithReturnedFalse<Field>> : {}) extends infer T_2 ? { [K_2 in keyof T_2]: T_2[K_2] } : never) & {
      user: {
        id: string;
        name: string;
        email: string;
        image: string | null | undefined;
      };
    })[];
    teams: ({
      id: string;
      name: string;
      organizationId: string;
      createdAt: Date;
      updatedAt?: Date | undefined;
    } & (O["schema"] extends {
      team?: {
        additionalFields: infer Field extends Record<string, _better_auth_core_db0.DBFieldAttribute>;
      } | undefined;
    } ? FieldAttributeToObject<RemoveFieldsWithReturnedFalse<Field>> : {}) extends infer T_3 ? { [K_3 in keyof T_3]: T_3[K_3] } : never)[] | undefined;
  }) | null>;
  listOrganizations: (userId: string) => Promise<InferOrganization<O>[]>;
  createTeam: (data: Omit<TeamInput, "id">) => Promise<{
    id: string;
    name: string;
    organizationId: string;
    createdAt: Date;
    updatedAt?: Date | undefined;
  } & (O["schema"] extends {
    team?: {
      additionalFields: infer Field extends Record<string, _better_auth_core_db0.DBFieldAttribute>;
    } | undefined;
  } ? FieldAttributeToObject<Field> : {}) extends infer T ? { [K in keyof T]: T[K] } : never>;
  findTeamById: <IncludeMembers extends boolean>({
    teamId,
    organizationId,
    includeTeamMembers
  }: {
    teamId: string;
    organizationId?: string | undefined;
    includeTeamMembers?: IncludeMembers | undefined;
  }) => Promise<(InferTeam<O> & (IncludeMembers extends true ? {
    members: TeamMember[];
  } : {})) | null>;
  updateTeam: (teamId: string, data: {
    name?: string | undefined;
    description?: string | undefined;
    status?: string | undefined;
  }) => Promise<(({
    id: string;
    name: string;
    organizationId: string;
    createdAt: Date;
    updatedAt?: Date | undefined;
  } & (O["schema"] extends {
    team?: {
      additionalFields: infer Field extends Record<string, _better_auth_core_db0.DBFieldAttribute>;
    } | undefined;
  } ? FieldAttributeToObject<Field> : {}) extends infer T ? { [K in keyof T]: T[K] } : never) & InferAdditionalFieldsFromPluginOptions<"team", O>) | null>;
  deleteTeam: (teamId: string) => Promise<void>;
  listTeams: (organizationId: string) => Promise<({
    id: string;
    name: string;
    organizationId: string;
    createdAt: Date;
    updatedAt?: Date | undefined;
  } & (O["schema"] extends {
    team?: {
      additionalFields: infer Field extends Record<string, _better_auth_core_db0.DBFieldAttribute>;
    } | undefined;
  } ? FieldAttributeToObject<Field> : {}) extends infer T ? { [K in keyof T]: T[K] } : never)[]>;
  createTeamInvitation: ({
    email,
    role,
    teamId,
    organizationId,
    inviterId,
    expiresIn
  }: {
    email: string;
    role: string;
    teamId: string;
    organizationId: string;
    inviterId: string;
    expiresIn?: number | undefined;
  }) => Promise<(O["teams"] extends {
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
  } ? FieldAttributeToObject<RemoveFieldsWithReturnedFalse<Field>> : {}) extends infer T ? { [K in keyof T]: T[K] } : never>;
  setActiveTeam: (sessionToken: string, teamId: string | null, ctx: GenericEndpointContext) => Promise<{
    id: string;
    createdAt: Date;
    updatedAt: Date;
    userId: string;
    expiresAt: Date;
    token: string;
    ipAddress?: string | null | undefined;
    userAgent?: string | null | undefined;
  }>;
  listTeamMembers: (data: {
    teamId: string;
  }) => Promise<{
    id: string;
    teamId: string;
    userId: string;
    createdAt: Date;
  }[]>;
  countTeamMembers: (data: {
    teamId: string;
  }) => Promise<number>;
  countMembers: (data: {
    organizationId: string;
  }) => Promise<number>;
  listTeamsByUser: (data: {
    userId: string;
  }) => Promise<{
    id: string;
    name: string;
    organizationId: string;
    createdAt: Date;
    updatedAt?: Date | undefined;
  }[]>;
  findTeamMember: (data: {
    teamId: string;
    userId: string;
  }) => Promise<{
    id: string;
    teamId: string;
    userId: string;
    createdAt: Date;
  } | null>;
  findOrCreateTeamMember: (data: {
    teamId: string;
    userId: string;
  }) => Promise<{
    id: string;
    teamId: string;
    userId: string;
    createdAt: Date;
  }>;
  removeTeamMember: (data: {
    teamId: string;
    userId: string;
  }) => Promise<void>;
  findInvitationsByTeamId: (teamId: string) => Promise<((O["teams"] extends {
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
  listUserInvitations: (email: string) => Promise<(Omit<((O["teams"] extends {
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
    organization: InferOrganization<O, false>;
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
  createInvitation: ({
    invitation,
    user
  }: {
    invitation: {
      email: string;
      role: string;
      organizationId: string;
      teamIds: string[];
    } & Record<string, any>;
    user: User$1;
  }) => Promise<(O["teams"] extends {
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
  } ? FieldAttributeToObject<Field> : {}) extends infer T ? { [K in keyof T]: T[K] } : never>;
  findInvitationById: (id: string) => Promise<((O["teams"] extends {
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
  findPendingInvitation: (data: {
    email: string;
    organizationId: string;
  }) => Promise<((O["teams"] extends {
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
  findPendingInvitations: (data: {
    organizationId: string;
  }) => Promise<((O["teams"] extends {
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
  listInvitations: (data: {
    organizationId: string;
  }) => Promise<((O["teams"] extends {
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
  updateInvitation: (data: {
    invitationId: string;
    status: "accepted" | "canceled" | "rejected";
  }) => Promise<((O["teams"] extends {
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
};
//#endregion
export { getOrgAdapter };
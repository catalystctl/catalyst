import { FieldAttributeToObject, RemoveFieldsWithReturnedFalse } from "../../db/field.mjs";
import { OrganizationOptions } from "./types.mjs";
import { BetterAuthPluginDBSchema, DBFieldAttribute } from "@better-auth/core/db";
import { Prettify } from "better-call";
import * as z from "zod";

//#region src/plugins/organization/schema.d.ts
type InferSchema<Schema extends BetterAuthPluginDBSchema, TableName extends string, DefaultFields> = {
  modelName: Schema[TableName] extends {
    modelName: infer M;
  } ? M extends string ? M : string : string;
  fields: { [K in keyof DefaultFields]: DefaultFields[K] } & (Schema[TableName] extends {
    additionalFields: infer F;
  } ? F : {});
};
interface OrganizationRoleDefaultFields {
  organizationId: {
    type: "string";
    required: true;
    references: {
      model: "organization";
      field: "id";
    };
  };
  role: {
    type: "string";
    required: true;
  };
  permission: {
    type: "string";
    required: true;
  };
  createdAt: {
    type: "date";
    required: true;
    defaultValue: Date;
  };
  updatedAt: {
    type: "date";
    required: false;
  };
}
interface TeamDefaultFields {
  name: {
    type: "string";
    required: true;
  };
  organizationId: {
    type: "string";
    required: true;
    references: {
      model: "organization";
      field: "id";
    };
  };
  createdAt: {
    type: "date";
    required: true;
  };
  updatedAt: {
    type: "date";
    required: false;
  };
}
interface TeamMemberDefaultFields {
  teamId: {
    type: "string";
    required: true;
    references: {
      model: "team";
      field: "id";
    };
  };
  userId: {
    type: "string";
    required: true;
    references: {
      model: "user";
      field: "id";
    };
  };
  createdAt: {
    type: "date";
    required: false;
  };
}
interface OrganizationDefaultFields {
  name: {
    type: "string";
    required: true;
    sortable: true;
  };
  slug: {
    type: "string";
    required: true;
    unique: true;
    sortable: true;
  };
  logo: {
    type: "string";
    required: false;
  };
  createdAt: {
    type: "date";
    required: true;
  };
  updatedAt: {
    type: "date";
    required: false;
  };
}
interface MemberDefaultFields {
  organizationId: {
    type: "string";
    required: true;
    references: {
      model: "organization";
      field: "id";
    };
  };
  userId: {
    type: "string";
    required: true;
    references: {
      model: "user";
      field: "id";
    };
  };
  role: {
    type: "string";
    required: true;
    defaultValue: "member";
  };
  createdAt: {
    type: "date";
    required: true;
  };
}
interface InvitationDefaultFields {
  organizationId: {
    type: "string";
    required: true;
    references: {
      model: "organization";
      field: "id";
    };
  };
  email: {
    type: "string";
    required: true;
    sortable: true;
  };
  role: {
    type: "string";
    required: true;
    sortable: true;
  };
  status: {
    type: "string";
    required: true;
    sortable: true;
    defaultValue: "pending";
  };
  expiresAt: {
    type: "date";
    required: false;
  };
  createdAt: {
    type: "date";
    required: true;
    defaultValue: Date;
  };
  inviterId: {
    type: "string";
    required: true;
    references: {
      model: "user";
      field: "id";
    };
  };
}
interface SessionDefaultFields {
  activeOrganizationId: {
    type: "string";
    required: false;
  };
}
type OrganizationSchema<O extends OrganizationOptions> = (O["dynamicAccessControl"] extends {
  enabled: true;
} ? {
  organizationRole: InferSchema<O["schema"] extends BetterAuthPluginDBSchema ? O["schema"] : {}, "organizationRole", OrganizationRoleDefaultFields>;
} & {
  session: {
    fields: InferSchema<O["schema"] extends BetterAuthPluginDBSchema ? O["schema"] : {}, "session", SessionDefaultFields>["fields"];
  };
} : {}) & (O["teams"] extends {
  enabled: true;
} ? {
  team: InferSchema<O["schema"] extends BetterAuthPluginDBSchema ? O["schema"] : {}, "team", TeamDefaultFields>;
  teamMember: InferSchema<O["schema"] extends BetterAuthPluginDBSchema ? O["schema"] : {}, "teamMember", TeamMemberDefaultFields>;
} : {}) & {
  organization: InferSchema<O["schema"] extends BetterAuthPluginDBSchema ? O["schema"] : {}, "organization", OrganizationDefaultFields>;
  member: InferSchema<O["schema"] extends BetterAuthPluginDBSchema ? O["schema"] : {}, "member", MemberDefaultFields>;
  invitation: {
    modelName: O["schema"] extends BetterAuthPluginDBSchema ? InferSchema<O["schema"], "invitation", InvitationDefaultFields>["modelName"] : string;
    fields: InferSchema<O["schema"] extends BetterAuthPluginDBSchema ? O["schema"] : {}, "invitation", InvitationDefaultFields>["fields"] & (O extends {
      teams: {
        enabled: true;
      };
    } ? {
      teamId: {
        type: "string";
        required: false;
        sortable: true;
      };
    } : {});
  };
  session: {
    fields: InferSchema<O["schema"] extends BetterAuthPluginDBSchema ? O["schema"] : {}, "session", SessionDefaultFields>["fields"] & (O["teams"] extends {
      enabled: true;
    } ? {
      activeTeamId: {
        type: "string";
        required: false;
      };
    } : {});
  };
};
declare const roleSchema: z.ZodString;
declare const invitationStatus: z.ZodDefault<z.ZodEnum<{
  canceled: "canceled";
  pending: "pending";
  accepted: "accepted";
  rejected: "rejected";
}>>;
declare const organizationSchema: z.ZodObject<{
  id: z.ZodDefault<z.ZodString>;
  name: z.ZodString;
  slug: z.ZodString;
  logo: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodString>>>;
  metadata: z.ZodOptional<z.ZodUnion<[z.ZodRecord<z.ZodString, z.ZodUnknown>, z.ZodPipe<z.ZodString, z.ZodTransform<any, string>>]>>;
  createdAt: z.ZodDate;
}, z.core.$strip>;
declare const memberSchema: z.ZodObject<{
  id: z.ZodDefault<z.ZodString>;
  organizationId: z.ZodString;
  userId: z.ZodCoercedString<unknown>;
  role: z.ZodString;
  createdAt: z.ZodDefault<z.ZodDate>;
}, z.core.$strip>;
declare const invitationSchema: z.ZodObject<{
  id: z.ZodDefault<z.ZodString>;
  organizationId: z.ZodString;
  email: z.ZodString;
  role: z.ZodString;
  status: z.ZodDefault<z.ZodEnum<{
    canceled: "canceled";
    pending: "pending";
    accepted: "accepted";
    rejected: "rejected";
  }>>;
  teamId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
  inviterId: z.ZodString;
  expiresAt: z.ZodDate;
  createdAt: z.ZodDefault<z.ZodDate>;
}, z.core.$strip>;
declare const teamSchema: z.ZodObject<{
  id: z.ZodDefault<z.ZodString>;
  name: z.ZodString;
  organizationId: z.ZodString;
  createdAt: z.ZodDate;
  updatedAt: z.ZodOptional<z.ZodDate>;
}, z.core.$strip>;
declare const teamMemberSchema: z.ZodObject<{
  id: z.ZodDefault<z.ZodString>;
  teamId: z.ZodString;
  userId: z.ZodString;
  createdAt: z.ZodDefault<z.ZodDate>;
}, z.core.$strip>;
declare const organizationRoleSchema: z.ZodObject<{
  id: z.ZodDefault<z.ZodString>;
  organizationId: z.ZodString;
  role: z.ZodString;
  permission: z.ZodRecord<z.ZodString, z.ZodArray<z.ZodString>>;
  createdAt: z.ZodDefault<z.ZodDate>;
  updatedAt: z.ZodOptional<z.ZodDate>;
}, z.core.$strip>;
type Organization = z.infer<typeof organizationSchema>;
type Member = z.infer<typeof memberSchema>;
type TeamMember = z.infer<typeof teamMemberSchema>;
type Team = z.infer<typeof teamSchema>;
type Invitation = z.infer<typeof invitationSchema>;
type InvitationInput = z.input<typeof invitationSchema>;
type MemberInput = z.input<typeof memberSchema>;
type TeamMemberInput = z.input<typeof teamMemberSchema>;
type OrganizationInput = z.input<typeof organizationSchema>;
type TeamInput = z.infer<typeof teamSchema>;
type OrganizationRole = z.infer<typeof organizationRoleSchema>;
declare const defaultRolesSchema: z.ZodUnion<readonly [z.ZodEnum<{
  admin: "admin";
  member: "member";
  owner: "owner";
}>, z.ZodArray<z.ZodEnum<{
  admin: "admin";
  member: "member";
  owner: "owner";
}>>]>;
type CustomRolesSchema<O> = O extends {
  roles: {
    [key: string]: any;
  };
} ? z.ZodType<keyof O["roles"] | Array<keyof O["roles"]>> : typeof defaultRolesSchema;
type InferOrganizationZodRolesFromOption<O extends OrganizationOptions | undefined> = CustomRolesSchema<O>;
type InferOrganizationRolesFromOption<O extends OrganizationOptions | undefined> = O extends {
  roles: any;
} ? keyof O["roles"] extends infer K extends string ? K : "admin" | "member" | "owner" : "admin" | "member" | "owner";
type InvitationStatus = "pending" | "accepted" | "rejected" | "canceled";
type InferAdditionalFieldsOutput<SchemaName extends string, Options extends OrganizationOptions, isClientSide extends boolean> = Options["schema"] extends { [key in SchemaName]?: {
  additionalFields: infer Field extends Record<string, DBFieldAttribute>;
} } ? isClientSide extends true ? FieldAttributeToObject<RemoveFieldsWithReturnedFalse<Field>> : FieldAttributeToObject<Field> : {};
type InferMember<O extends OrganizationOptions, isClientSide extends boolean = true> = Prettify<(O["teams"] extends {
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
}) & InferAdditionalFieldsOutput<"member", O, isClientSide>>;
type InferOrganization<O extends OrganizationOptions, isClientSide extends boolean = true> = Prettify<Organization & InferAdditionalFieldsOutput<"organization", O, isClientSide>>;
type InferTeam<O extends OrganizationOptions, isClientSide extends boolean = true> = Prettify<Team & InferAdditionalFieldsOutput<"team", O, isClientSide>>;
type InferInvitation<O extends OrganizationOptions, isClientSide extends boolean = true> = Prettify<(O["teams"] extends {
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
}) & InferAdditionalFieldsOutput<"invitation", O, isClientSide>>;
//#endregion
export { InferInvitation, InferMember, InferOrganization, InferOrganizationRolesFromOption, InferOrganizationZodRolesFromOption, InferTeam, Invitation, InvitationInput, InvitationStatus, Member, MemberInput, Organization, OrganizationInput, OrganizationRole, OrganizationSchema, Team, TeamInput, TeamMember, TeamMemberInput, defaultRolesSchema, invitationSchema, invitationStatus, memberSchema, organizationRoleSchema, organizationSchema, roleSchema, teamMemberSchema, teamSchema };
import { InferAdditionalFieldsFromPluginOptions } from "../../../db/field.mjs";
import { Statements, Subset } from "../../access/types.mjs";
import { OrganizationOptions } from "../types.mjs";
import { OrganizationRole } from "../schema.mjs";
import * as better_call0 from "better-call";
import * as z from "zod";

//#region src/plugins/organization/routes/crud-access-control.d.ts
type IsExactlyEmptyObject<T> = keyof T extends never ? T extends {} ? {} extends T ? true : false : false : false;
declare const createOrgRole: <O extends OrganizationOptions>(options: O) => better_call0.StrictEndpoint<"/organization/create-role", {
  method: "POST";
  body: z.ZodObject<{
    organizationId: z.ZodOptional<z.ZodString>;
    role: z.ZodString;
    permission: z.ZodRecord<z.ZodString, z.ZodArray<z.ZodString>>;
    additionalFields: z.ZodOptional<z.ZodObject<{
      [x: string]: z.ZodOptional<z.ZodAny>;
    }, z.core.$strip>>;
  }, z.core.$strip>;
  metadata: {
    $Infer: {
      body: {
        organizationId?: string | undefined;
        role: string;
        permission: Record<string, string[]>;
      } & (IsExactlyEmptyObject<InferAdditionalFieldsFromPluginOptions<"organizationRole", O, true>> extends true ? {
        additionalFields?: {} | undefined;
      } : {
        additionalFields: InferAdditionalFieldsFromPluginOptions<"organizationRole", O, true>;
      });
    };
  };
  requireHeaders: true;
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
}, {
  success: boolean;
  roleData: {
    id: string;
    organizationId: string;
    role: string;
    permission: Record<string, string[]>;
    createdAt: Date;
    updatedAt?: Date | undefined;
  } & InferAdditionalFieldsFromPluginOptions<"organizationRole", O, false>;
  statements: Subset<string, Statements>;
}>;
declare const deleteOrgRole: <O extends OrganizationOptions>(options: O) => better_call0.StrictEndpoint<"/organization/delete-role", {
  method: "POST";
  body: z.ZodIntersection<z.ZodObject<{
    organizationId: z.ZodOptional<z.ZodString>;
  }, z.core.$strip>, z.ZodUnion<readonly [z.ZodObject<{
    roleName: z.ZodString;
  }, z.core.$strip>, z.ZodObject<{
    roleId: z.ZodString;
  }, z.core.$strip>]>>;
  requireHeaders: true;
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
        roleName?: string | undefined;
        roleId?: string | undefined;
        organizationId?: string | undefined;
      };
    };
  };
}, {
  success: boolean;
}>;
declare const listOrgRoles: <O extends OrganizationOptions>(options: O) => better_call0.StrictEndpoint<"/organization/list-roles", {
  method: "GET";
  requireHeaders: true;
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
  query: z.ZodOptional<z.ZodObject<{
    organizationId: z.ZodOptional<z.ZodString>;
  }, z.core.$strip>>;
}, ({
  id: string;
  organizationId: string;
  role: string;
  permission: Record<string, string[]>;
  createdAt: Date;
  updatedAt?: Date | undefined;
} & InferAdditionalFieldsFromPluginOptions<"organizationRole", O, false>)[]>;
declare const getOrgRole: <O extends OrganizationOptions>(options: O) => better_call0.StrictEndpoint<"/organization/get-role", {
  method: "GET";
  requireHeaders: true;
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
  query: z.ZodOptional<z.ZodIntersection<z.ZodObject<{
    organizationId: z.ZodOptional<z.ZodString>;
  }, z.core.$strip>, z.ZodUnion<readonly [z.ZodObject<{
    roleName: z.ZodString;
  }, z.core.$strip>, z.ZodObject<{
    roleId: z.ZodString;
  }, z.core.$strip>]>>>;
  metadata: {
    $Infer: {
      query: {
        organizationId?: string | undefined;
        roleName?: string | undefined;
        roleId?: string | undefined;
      };
    };
  };
}, {
  id: string;
  organizationId: string;
  role: string;
  permission: Record<string, string[]>;
  createdAt: Date;
  updatedAt?: Date | undefined;
} & InferAdditionalFieldsFromPluginOptions<"organizationRole", O, false>>;
declare const updateOrgRole: <O extends OrganizationOptions>(options: O) => better_call0.StrictEndpoint<"/organization/update-role", {
  method: "POST";
  body: z.ZodIntersection<z.ZodObject<{
    organizationId: z.ZodOptional<z.ZodString>;
    data: z.ZodObject<{
      permission: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodArray<z.ZodString>>>;
      roleName: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>;
  }, z.core.$strip>, z.ZodUnion<readonly [z.ZodObject<{
    roleName: z.ZodString;
  }, z.core.$strip>, z.ZodObject<{
    roleId: z.ZodString;
  }, z.core.$strip>]>>;
  metadata: {
    $Infer: {
      body: {
        organizationId?: string | undefined;
        data: {
          permission?: Record<string, string[]> | undefined;
          roleName?: string | undefined;
        } & Partial<InferAdditionalFieldsFromPluginOptions<"organizationRole", O, true>>;
        roleName?: string | undefined;
        roleId?: string | undefined;
      };
    };
  };
  requireHeaders: true;
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
}, {
  success: boolean;
  roleData: OrganizationRole & InferAdditionalFieldsFromPluginOptions<"organizationRole", O, false>;
}>;
//#endregion
export { createOrgRole, deleteOrgRole, getOrgRole, listOrgRoles, updateOrgRole };
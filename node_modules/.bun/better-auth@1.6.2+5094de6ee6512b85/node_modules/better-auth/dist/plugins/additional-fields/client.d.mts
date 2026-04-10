import { BetterAuthOptions, BetterAuthPlugin } from "@better-auth/core";
import { DBFieldAttribute } from "@better-auth/core/db";

//#region src/plugins/additional-fields/client.d.ts
declare const inferAdditionalFields: <T, S extends {
  user?: {
    [key: string]: DBFieldAttribute;
  } | undefined;
  session?: {
    [key: string]: DBFieldAttribute;
  } | undefined;
} = {}>(schema?: S | undefined) => {
  id: "additional-fields-client";
  version: string;
  $InferServerPlugin: ((T extends BetterAuthOptions ? T : T extends {
    options: BetterAuthOptions;
  } ? T["options"] : never) extends never ? S extends {
    user?: {
      [key: string]: DBFieldAttribute;
    } | undefined;
    session?: {
      [key: string]: DBFieldAttribute;
    } | undefined;
  } ? {
    id: "additional-fields-client";
    version: string;
    schema: {
      user: {
        fields: S["user"] extends object ? S["user"] : {};
      };
      session: {
        fields: S["session"] extends object ? S["session"] : {};
      };
    };
  } : never : (T extends BetterAuthOptions ? T : T extends {
    options: BetterAuthOptions;
  } ? T["options"] : never) extends BetterAuthOptions ? {
    id: "additional-fields";
    version: string;
    schema: {
      user: {
        fields: (T extends BetterAuthOptions ? T : T extends {
          options: BetterAuthOptions;
        } ? T["options"] : never)["user"] extends {
          additionalFields: infer U;
        } ? U : {};
      };
      session: {
        fields: (T extends BetterAuthOptions ? T : T extends {
          options: BetterAuthOptions;
        } ? T["options"] : never)["session"] extends {
          additionalFields: infer U;
        } ? U : {};
      };
    };
  } : never) extends BetterAuthPlugin ? (T extends BetterAuthOptions ? T : T extends {
    options: BetterAuthOptions;
  } ? T["options"] : never) extends never ? S extends {
    user?: {
      [key: string]: DBFieldAttribute;
    } | undefined;
    session?: {
      [key: string]: DBFieldAttribute;
    } | undefined;
  } ? {
    id: "additional-fields-client";
    version: string;
    schema: {
      user: {
        fields: S["user"] extends object ? S["user"] : {};
      };
      session: {
        fields: S["session"] extends object ? S["session"] : {};
      };
    };
  } : never : (T extends BetterAuthOptions ? T : T extends {
    options: BetterAuthOptions;
  } ? T["options"] : never) extends BetterAuthOptions ? {
    id: "additional-fields";
    version: string;
    schema: {
      user: {
        fields: (T extends BetterAuthOptions ? T : T extends {
          options: BetterAuthOptions;
        } ? T["options"] : never)["user"] extends {
          additionalFields: infer U;
        } ? U : {};
      };
      session: {
        fields: (T extends BetterAuthOptions ? T : T extends {
          options: BetterAuthOptions;
        } ? T["options"] : never)["session"] extends {
          additionalFields: infer U;
        } ? U : {};
      };
    };
  } : never : undefined;
};
//#endregion
export { inferAdditionalFields };
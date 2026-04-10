import { InferDBFieldsFromOptions, InferDBFieldsFromPlugins } from "../type.mjs";
import { Prettify } from "../../types/helper.mjs";
import { BetterAuthOptions } from "../../types/init-options.mjs";
import * as z from "zod";

//#region src/db/schema/account.d.ts
declare const accountSchema: z.ZodObject<{
  id: z.ZodString;
  createdAt: z.ZodDefault<z.ZodDate>;
  updatedAt: z.ZodDefault<z.ZodDate>;
  providerId: z.ZodString;
  accountId: z.ZodString;
  userId: z.ZodCoercedString<unknown>;
  accessToken: z.ZodOptional<z.ZodNullable<z.ZodString>>;
  refreshToken: z.ZodOptional<z.ZodNullable<z.ZodString>>;
  idToken: z.ZodOptional<z.ZodNullable<z.ZodString>>;
  accessTokenExpiresAt: z.ZodOptional<z.ZodNullable<z.ZodDate>>;
  refreshTokenExpiresAt: z.ZodOptional<z.ZodNullable<z.ZodDate>>;
  scope: z.ZodOptional<z.ZodNullable<z.ZodString>>;
  password: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.core.$strip>;
type BaseAccount = z.infer<typeof accountSchema>;
/**
 * Account schema type used by better-auth, note that it's possible that account could have additional fields
 */
type Account<DBOptions extends BetterAuthOptions["account"] = BetterAuthOptions["account"], Plugins extends BetterAuthOptions["plugins"] = BetterAuthOptions["plugins"]> = Prettify<BaseAccount & InferDBFieldsFromOptions<DBOptions> & InferDBFieldsFromPlugins<"account", Plugins>>;
//#endregion
export { Account, BaseAccount, accountSchema };
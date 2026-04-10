import { InferDBFieldsFromOptions, InferDBFieldsFromPlugins } from "../type.mjs";
import { Prettify } from "../../types/helper.mjs";
import { BetterAuthOptions } from "../../types/init-options.mjs";
import * as z from "zod";

//#region src/db/schema/user.d.ts
declare const userSchema: z.ZodObject<{
  id: z.ZodString;
  createdAt: z.ZodDefault<z.ZodDate>;
  updatedAt: z.ZodDefault<z.ZodDate>;
  email: z.ZodPipe<z.ZodString, z.ZodTransform<string, string>>;
  emailVerified: z.ZodDefault<z.ZodBoolean>;
  name: z.ZodString;
  image: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.core.$strip>;
type BaseUser = z.infer<typeof userSchema>;
/**
 * User schema type used by better-auth, note that it's possible that user could have additional fields
 */
type User<DBOptions extends BetterAuthOptions["user"] = BetterAuthOptions["user"], Plugins extends BetterAuthOptions["plugins"] = BetterAuthOptions["plugins"]> = Prettify<BaseUser & InferDBFieldsFromOptions<DBOptions> & InferDBFieldsFromPlugins<"user", Plugins>>;
//#endregion
export { BaseUser, User, userSchema };
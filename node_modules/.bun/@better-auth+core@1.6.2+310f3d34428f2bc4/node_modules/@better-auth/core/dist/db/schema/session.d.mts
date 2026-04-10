import { InferDBFieldsFromOptions, InferDBFieldsFromPlugins } from "../type.mjs";
import { Prettify } from "../../types/helper.mjs";
import { BetterAuthOptions } from "../../types/init-options.mjs";
import * as z from "zod";

//#region src/db/schema/session.d.ts
declare const sessionSchema: z.ZodObject<{
  id: z.ZodString;
  createdAt: z.ZodDefault<z.ZodDate>;
  updatedAt: z.ZodDefault<z.ZodDate>;
  userId: z.ZodCoercedString<unknown>;
  expiresAt: z.ZodDate;
  token: z.ZodString;
  ipAddress: z.ZodOptional<z.ZodNullable<z.ZodString>>;
  userAgent: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.core.$strip>;
type BaseSession = z.infer<typeof sessionSchema>;
/**
 * Session schema type used by better-auth, note that it's possible that session could have additional fields
 */
type Session<DBOptions extends BetterAuthOptions["session"] = BetterAuthOptions["session"], Plugins extends BetterAuthOptions["plugins"] = BetterAuthOptions["plugins"]> = Prettify<z.infer<typeof sessionSchema> & InferDBFieldsFromOptions<DBOptions> & InferDBFieldsFromPlugins<"session", Plugins>>;
//#endregion
export { BaseSession, Session, sessionSchema };
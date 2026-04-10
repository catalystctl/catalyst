import { InferDBFieldsFromOptions, InferDBFieldsFromPlugins } from "../type.mjs";
import { Prettify } from "../../types/helper.mjs";
import { BetterAuthOptions } from "../../types/init-options.mjs";
import * as z from "zod";

//#region src/db/schema/verification.d.ts
declare const verificationSchema: z.ZodObject<{
  id: z.ZodString;
  createdAt: z.ZodDefault<z.ZodDate>;
  updatedAt: z.ZodDefault<z.ZodDate>;
  value: z.ZodString;
  expiresAt: z.ZodDate;
  identifier: z.ZodString;
}, z.core.$strip>;
type BaseVerification = z.infer<typeof verificationSchema>;
/**
 * Verification schema type used by better-auth, note that it's possible that verification could have additional fields
 */
type Verification<DBOptions extends BetterAuthOptions["verification"] = BetterAuthOptions["verification"], Plugins extends BetterAuthOptions["plugins"] = BetterAuthOptions["plugins"]> = Prettify<BaseVerification & InferDBFieldsFromOptions<DBOptions> & InferDBFieldsFromPlugins<"verification", Plugins>>;
//#endregion
export { BaseVerification, Verification, verificationSchema };
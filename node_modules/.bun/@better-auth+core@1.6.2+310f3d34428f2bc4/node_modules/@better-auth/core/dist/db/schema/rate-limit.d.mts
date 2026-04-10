import { InferDBFieldsFromOptions, InferDBFieldsFromPlugins } from "../type.mjs";
import { Prettify } from "../../types/helper.mjs";
import { BetterAuthOptions } from "../../types/init-options.mjs";
import * as z from "zod";

//#region src/db/schema/rate-limit.d.ts
declare const rateLimitSchema: z.ZodObject<{
  key: z.ZodString;
  count: z.ZodNumber;
  lastRequest: z.ZodNumber;
}, z.core.$strip>;
type BaseRateLimit = z.infer<typeof rateLimitSchema>;
/**
 * Rate limit schema type used by better-auth for rate limiting
 */
type RateLimit<DBOptions extends BetterAuthOptions["rateLimit"] = BetterAuthOptions["rateLimit"], Plugins extends BetterAuthOptions["plugins"] = BetterAuthOptions["plugins"]> = Prettify<BaseRateLimit & InferDBFieldsFromOptions<DBOptions> & InferDBFieldsFromPlugins<"rateLimit", Plugins>>;
//#endregion
export { BaseRateLimit, RateLimit, rateLimitSchema };
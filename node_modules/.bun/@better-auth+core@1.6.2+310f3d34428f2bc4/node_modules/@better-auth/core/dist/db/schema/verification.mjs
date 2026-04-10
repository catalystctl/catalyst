import { coreSchema } from "./shared.mjs";
import * as z from "zod";
//#region src/db/schema/verification.ts
const verificationSchema = coreSchema.extend({
	value: z.string(),
	expiresAt: z.date(),
	identifier: z.string()
});
//#endregion
export { verificationSchema };

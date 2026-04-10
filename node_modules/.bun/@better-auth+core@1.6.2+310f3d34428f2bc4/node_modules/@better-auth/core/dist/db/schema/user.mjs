import { coreSchema } from "./shared.mjs";
import * as z from "zod";
//#region src/db/schema/user.ts
const userSchema = coreSchema.extend({
	email: z.string().transform((val) => val.toLowerCase()),
	emailVerified: z.boolean().default(false),
	name: z.string(),
	image: z.string().nullish()
});
//#endregion
export { userSchema };

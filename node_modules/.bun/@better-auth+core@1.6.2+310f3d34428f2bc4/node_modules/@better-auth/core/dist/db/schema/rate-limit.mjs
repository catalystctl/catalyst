import * as z from "zod";
//#region src/db/schema/rate-limit.ts
const rateLimitSchema = z.object({
	key: z.string(),
	count: z.number(),
	lastRequest: z.number()
});
//#endregion
export { rateLimitSchema };

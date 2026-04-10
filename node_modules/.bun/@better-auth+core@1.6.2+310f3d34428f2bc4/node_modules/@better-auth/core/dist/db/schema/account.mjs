import { coreSchema } from "./shared.mjs";
import * as z from "zod";
//#region src/db/schema/account.ts
const accountSchema = coreSchema.extend({
	providerId: z.string(),
	accountId: z.string(),
	userId: z.coerce.string(),
	accessToken: z.string().nullish(),
	refreshToken: z.string().nullish(),
	idToken: z.string().nullish(),
	accessTokenExpiresAt: z.date().nullish(),
	refreshTokenExpiresAt: z.date().nullish(),
	scope: z.string().nullish(),
	password: z.string().nullish()
});
//#endregion
export { accountSchema };

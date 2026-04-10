import * as z from "zod";
//#region src/db/schema/shared.ts
const coreSchema = z.object({
	id: z.string(),
	createdAt: z.date().default(() => /* @__PURE__ */ new Date()),
	updatedAt: z.date().default(() => /* @__PURE__ */ new Date())
});
//#endregion
export { coreSchema };

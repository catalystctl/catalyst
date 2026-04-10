import * as z from "zod";

//#region src/db/schema/shared.d.ts
declare const coreSchema: z.ZodObject<{
  id: z.ZodString;
  createdAt: z.ZodDefault<z.ZodDate>;
  updatedAt: z.ZodDefault<z.ZodDate>;
}, z.core.$strip>;
//#endregion
export { coreSchema };
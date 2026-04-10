import { __exportAll, __reExport } from "../_virtual/_rolldown/runtime.mjs";
import { getSchema } from "./get-schema.mjs";
import { convertFromDB, convertToDB } from "./field-converter.mjs";
import { getSessionDefaultFields, mergeSchema, parseAccountInput, parseAccountOutput, parseAdditionalUserInput, parseInputData, parseSessionInput, parseSessionOutput, parseUserInput, parseUserOutput } from "./schema.mjs";
import { getWithHooks } from "./with-hooks.mjs";
import { createInternalAdapter } from "./internal-adapter.mjs";
import { toZodSchema } from "./to-zod.mjs";
export * from "@better-auth/core/db";
//#region src/db/index.ts
var db_exports = /* @__PURE__ */ __exportAll({
	convertFromDB: () => convertFromDB,
	convertToDB: () => convertToDB,
	createInternalAdapter: () => createInternalAdapter,
	getSchema: () => getSchema,
	getSessionDefaultFields: () => getSessionDefaultFields,
	getWithHooks: () => getWithHooks,
	mergeSchema: () => mergeSchema,
	parseAccountInput: () => parseAccountInput,
	parseAccountOutput: () => parseAccountOutput,
	parseAdditionalUserInput: () => parseAdditionalUserInput,
	parseInputData: () => parseInputData,
	parseSessionInput: () => parseSessionInput,
	parseSessionOutput: () => parseSessionOutput,
	parseUserInput: () => parseUserInput,
	parseUserOutput: () => parseUserOutput,
	toZodSchema: () => toZodSchema
});
import * as import__better_auth_core_db from "@better-auth/core/db";
__reExport(db_exports, import__better_auth_core_db);
//#endregion
export { convertFromDB, convertToDB, createInternalAdapter, db_exports, getSchema, getSessionDefaultFields, getWithHooks, mergeSchema, parseAccountInput, parseAccountOutput, parseAdditionalUserInput, parseInputData, parseSessionInput, parseSessionOutput, parseUserInput, parseUserOutput, toZodSchema };

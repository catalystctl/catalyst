import { initGetDefaultModelName } from "./get-default-model-name.mjs";
import { initGetDefaultFieldName } from "./get-default-field-name.mjs";
import { initGetIdField } from "./get-id-field.mjs";
import { initGetFieldAttributes } from "./get-field-attributes.mjs";
import { initGetFieldName } from "./get-field-name.mjs";
import { initGetModelName } from "./get-model-name.mjs";
import { deepmerge, withApplyDefault } from "./utils.mjs";
import { createAdapterFactory } from "./factory.mjs";
//#region src/db/adapter/index.ts
const whereOperators = [
	"eq",
	"ne",
	"lt",
	"lte",
	"gt",
	"gte",
	"in",
	"not_in",
	"contains",
	"starts_with",
	"ends_with"
];
//#endregion
export { createAdapterFactory, deepmerge, initGetDefaultFieldName, initGetDefaultModelName, initGetFieldAttributes, initGetFieldName, initGetIdField, initGetModelName, whereOperators, withApplyDefault };

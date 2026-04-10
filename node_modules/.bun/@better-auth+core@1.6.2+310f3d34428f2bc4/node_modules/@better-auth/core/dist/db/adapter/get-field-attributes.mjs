import { BetterAuthError } from "../../error/index.mjs";
import { initGetDefaultModelName } from "./get-default-model-name.mjs";
import { initGetDefaultFieldName } from "./get-default-field-name.mjs";
import { initGetIdField } from "./get-id-field.mjs";
//#region src/db/adapter/get-field-attributes.ts
const initGetFieldAttributes = ({ usePlural, schema, options, customIdGenerator, disableIdGeneration }) => {
	const getDefaultModelName = initGetDefaultModelName({
		usePlural,
		schema
	});
	const getDefaultFieldName = initGetDefaultFieldName({
		usePlural,
		schema
	});
	const idField = initGetIdField({
		usePlural,
		schema,
		options,
		customIdGenerator,
		disableIdGeneration
	});
	const getFieldAttributes = ({ model, field }) => {
		const defaultModelName = getDefaultModelName(model);
		const defaultFieldName = getDefaultFieldName({
			field,
			model: defaultModelName
		});
		const fields = schema[defaultModelName].fields;
		fields.id = idField({ customModelName: defaultModelName });
		const fieldAttributes = fields[defaultFieldName];
		if (!fieldAttributes) throw new BetterAuthError(`Field ${field} not found in model ${model}`);
		return fieldAttributes;
	};
	return getFieldAttributes;
};
//#endregion
export { initGetFieldAttributes };

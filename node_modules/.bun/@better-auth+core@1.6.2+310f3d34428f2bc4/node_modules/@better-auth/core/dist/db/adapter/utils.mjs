//#region src/db/adapter/utils.ts
function withApplyDefault(value, field, action) {
	if (action === "update") {
		if (value === void 0 && field.onUpdate !== void 0) {
			if (typeof field.onUpdate === "function") return field.onUpdate();
			return field.onUpdate;
		}
		return value;
	}
	if (action === "create") {
		if (value === void 0 || field.required === true && value === null) {
			if (field.defaultValue !== void 0) {
				if (typeof field.defaultValue === "function") return field.defaultValue();
				return field.defaultValue;
			}
		}
	}
	return value;
}
function isObject(item) {
	return item !== null && typeof item === "object" && !Array.isArray(item);
}
function deepmerge(target, source) {
	if (Array.isArray(target) && Array.isArray(source)) return [...target, ...source];
	else if (isObject(target) && isObject(source)) {
		const result = { ...target };
		for (const [key, value] of Object.entries(source)) {
			if (value === void 0) continue;
			if (key in target) result[key] = deepmerge(target[key], value);
			else result[key] = value;
		}
		return result;
	}
	return source;
}
//#endregion
export { deepmerge, withApplyDefault };

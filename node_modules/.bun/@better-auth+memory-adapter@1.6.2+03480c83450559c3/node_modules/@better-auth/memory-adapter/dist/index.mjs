import { createAdapterFactory } from "@better-auth/core/db/adapter";
import { logger } from "@better-auth/core/env";
//#region src/query-builders.ts
/**
* Case-insensitive in-memory comparison helpers.
* Used when evaluating where clauses in the memory adapter.
*/
function insensitiveCompare(a, b) {
	if (typeof a === "string" && typeof b === "string") return a.toLowerCase() === b.toLowerCase();
	return a === b;
}
function insensitiveIn(recordVal, values) {
	if (typeof recordVal !== "string") return values.includes(recordVal);
	return values.some((v) => typeof v === "string" && recordVal.toLowerCase() === v.toLowerCase());
}
function insensitiveNotIn(recordVal, values) {
	return !insensitiveIn(recordVal, values);
}
function insensitiveContains(recordVal, value) {
	if (typeof recordVal !== "string" || typeof value !== "string") return false;
	return recordVal.toLowerCase().includes(value.toLowerCase());
}
function insensitiveStartsWith(recordVal, value) {
	if (typeof recordVal !== "string" || typeof value !== "string") return false;
	return recordVal.toLowerCase().startsWith(value.toLowerCase());
}
function insensitiveEndsWith(recordVal, value) {
	if (typeof recordVal !== "string" || typeof value !== "string") return false;
	return recordVal.toLowerCase().endsWith(value.toLowerCase());
}
//#endregion
//#region src/memory-adapter.ts
const memoryAdapter = (db, config) => {
	let lazyOptions = null;
	const adapterCreator = createAdapterFactory({
		config: {
			adapterId: "memory",
			adapterName: "Memory Adapter",
			usePlural: false,
			debugLogs: config?.debugLogs || false,
			supportsArrays: true,
			customTransformInput(props) {
				if (props.options.advanced?.database?.generateId === "serial" && props.field === "id" && props.action === "create") return db[props.model].length + 1;
				return props.data;
			},
			transaction: async (cb) => {
				const clone = structuredClone(db);
				try {
					return await cb(adapterCreator(lazyOptions));
				} catch (error) {
					Object.keys(db).forEach((key) => {
						db[key] = clone[key];
					});
					throw error;
				}
			}
		},
		adapter: ({ getFieldName, getDefaultFieldName, options, getModelName }) => {
			const applySortToRecords = (records, sortBy, model) => {
				if (!sortBy) return records;
				return records.sort((a, b) => {
					const field = getFieldName({
						model,
						field: sortBy.field
					});
					const aValue = a[field];
					const bValue = b[field];
					let comparison = 0;
					if (aValue == null && bValue == null) comparison = 0;
					else if (aValue == null) comparison = -1;
					else if (bValue == null) comparison = 1;
					else if (typeof aValue === "string" && typeof bValue === "string") comparison = aValue.localeCompare(bValue);
					else if (aValue instanceof Date && bValue instanceof Date) comparison = aValue.getTime() - bValue.getTime();
					else if (typeof aValue === "number" && typeof bValue === "number") comparison = aValue - bValue;
					else if (typeof aValue === "boolean" && typeof bValue === "boolean") comparison = aValue === bValue ? 0 : aValue ? 1 : -1;
					else comparison = String(aValue).localeCompare(String(bValue));
					return sortBy.direction === "asc" ? comparison : -comparison;
				});
			};
			function convertWhereClause(where, model, join, select) {
				const baseRecords = (() => {
					const table = db[model];
					if (!table) {
						logger.error(`[MemoryAdapter] Model ${model} not found in the DB`, Object.keys(db));
						throw new Error(`Model ${model} not found`);
					}
					const evalClause = (record, clause) => {
						const { field, value, operator, mode = "sensitive" } = clause;
						const isInsensitive = mode === "insensitive" && (typeof value === "string" || Array.isArray(value) && value.every((v) => typeof v === "string"));
						switch (operator) {
							case "in":
								if (!Array.isArray(value)) throw new Error("Value must be an array");
								if (isInsensitive) return insensitiveIn(record[field], value);
								return value.includes(record[field]);
							case "not_in":
								if (!Array.isArray(value)) throw new Error("Value must be an array");
								if (isInsensitive) return insensitiveNotIn(record[field], value);
								return !value.includes(record[field]);
							case "contains":
								if (isInsensitive) return insensitiveContains(record[field], value);
								return record[field]?.includes(value);
							case "starts_with":
								if (isInsensitive) return insensitiveStartsWith(record[field], value);
								return record[field].startsWith(value);
							case "ends_with":
								if (isInsensitive) return insensitiveEndsWith(record[field], value);
								return record[field].endsWith(value);
							case "ne": return isInsensitive ? !insensitiveCompare(record[field], value) : record[field] !== value;
							case "gt": return value != null && Boolean(record[field] > value);
							case "gte": return value != null && Boolean(record[field] >= value);
							case "lt": return value != null && Boolean(record[field] < value);
							case "lte": return value != null && Boolean(record[field] <= value);
							default: return isInsensitive ? insensitiveCompare(record[field], value) : record[field] === value;
						}
					};
					let records = table.filter((record) => {
						if (!where.length || where.length === 0) return true;
						let result = evalClause(record, where[0]);
						for (const clause of where) {
							const clauseResult = evalClause(record, clause);
							if (clause.connector === "OR") result = result || clauseResult;
							else result = result && clauseResult;
						}
						return result;
					});
					if (select?.length && select.length > 0) records = records.map((record) => Object.fromEntries(Object.entries(record).filter(([key]) => select.includes(getDefaultFieldName({
						model,
						field: key
					})))));
					return records;
				})();
				if (!join) return baseRecords;
				const grouped = /* @__PURE__ */ new Map();
				const seenIds = /* @__PURE__ */ new Map();
				for (const baseRecord of baseRecords) {
					const baseId = String(baseRecord.id);
					if (!grouped.has(baseId)) {
						const nested = { ...baseRecord };
						for (const [joinModel, joinAttr] of Object.entries(join)) {
							const joinModelName = getModelName(joinModel);
							if (joinAttr.relation === "one-to-one") nested[joinModelName] = null;
							else {
								nested[joinModelName] = [];
								seenIds.set(`${baseId}-${joinModel}`, /* @__PURE__ */ new Set());
							}
						}
						grouped.set(baseId, nested);
					}
					const nestedEntry = grouped.get(baseId);
					for (const [joinModel, joinAttr] of Object.entries(join)) {
						const joinModelName = getModelName(joinModel);
						const joinTable = db[joinModelName];
						if (!joinTable) {
							logger.error(`[MemoryAdapter] JoinOption model ${joinModelName} not found in the DB`, Object.keys(db));
							throw new Error(`JoinOption model ${joinModelName} not found`);
						}
						const matchingRecords = joinTable.filter((joinRecord) => joinRecord[joinAttr.on.to] === baseRecord[joinAttr.on.from]);
						if (joinAttr.relation === "one-to-one") nestedEntry[joinModelName] = matchingRecords[0] || null;
						else {
							const seenSet = seenIds.get(`${baseId}-${joinModel}`);
							const limit = joinAttr.limit ?? 100;
							let count = 0;
							for (const matchingRecord of matchingRecords) {
								if (count >= limit) break;
								if (!seenSet.has(matchingRecord.id)) {
									nestedEntry[joinModelName].push(matchingRecord);
									seenSet.add(matchingRecord.id);
									count++;
								}
							}
						}
					}
				}
				return Array.from(grouped.values());
			}
			return {
				create: async ({ model, data }) => {
					if (options.advanced?.database?.generateId === "serial") data.id = db[getModelName(model)].length + 1;
					if (!db[model]) db[model] = [];
					db[model].push(data);
					return data;
				},
				findOne: async ({ model, where, select, join }) => {
					const res = convertWhereClause(where, model, join, select);
					if (join) {
						const resArray = res;
						if (!resArray.length) return null;
						return resArray[0];
					}
					return res[0] || null;
				},
				findMany: async ({ model, where, sortBy, limit, select, offset, join }) => {
					const res = convertWhereClause(where || [], model, join, select);
					if (join) {
						const resArray = res;
						if (!resArray.length) return [];
						applySortToRecords(resArray, sortBy, model);
						let paginatedRecords = resArray;
						if (offset !== void 0) paginatedRecords = paginatedRecords.slice(offset);
						if (limit !== void 0) paginatedRecords = paginatedRecords.slice(0, limit);
						return paginatedRecords;
					}
					let table = applySortToRecords(res, sortBy, model);
					if (offset !== void 0) table = table.slice(offset);
					if (limit !== void 0) table = table.slice(0, limit);
					return table || [];
				},
				count: async ({ model, where }) => {
					if (where) return convertWhereClause(where, model).length;
					return db[model].length;
				},
				update: async ({ model, where, update }) => {
					const res = convertWhereClause(where, model);
					res.forEach((record) => {
						Object.assign(record, update);
					});
					return res[0] || null;
				},
				delete: async ({ model, where }) => {
					const table = db[model];
					const res = convertWhereClause(where, model);
					db[model] = table.filter((record) => !res.includes(record));
				},
				deleteMany: async ({ model, where }) => {
					const table = db[model];
					const res = convertWhereClause(where, model);
					let count = 0;
					db[model] = table.filter((record) => {
						if (res.includes(record)) {
							count++;
							return false;
						}
						return !res.includes(record);
					});
					return count;
				},
				updateMany({ model, where, update }) {
					const res = convertWhereClause(where, model);
					res.forEach((record) => {
						Object.assign(record, update);
					});
					return res[0] || null;
				}
			};
		}
	});
	return (options) => {
		lazyOptions = options;
		return adapterCreator(options);
	};
};
//#endregion
export { memoryAdapter };

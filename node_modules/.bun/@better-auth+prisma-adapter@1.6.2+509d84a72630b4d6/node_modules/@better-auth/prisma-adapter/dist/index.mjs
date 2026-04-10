import { createAdapterFactory } from "@better-auth/core/db/adapter";
import { BetterAuthError } from "@better-auth/core/error";
//#region src/prisma-adapter.ts
const prismaAdapter = (prisma, config) => {
	let lazyOptions = null;
	const createCustomAdapter = (prisma) => ({ getFieldName, getModelName, getFieldAttributes, getDefaultModelName, schema }) => {
		const db = prisma;
		const convertSelect = (select, model, join) => {
			if (!select && !join) return void 0;
			const result = {};
			if (select) for (const field of select) result[getFieldName({
				model,
				field
			})] = true;
			if (join) {
				if (!select) {
					const fields = schema[getDefaultModelName(model)]?.fields || {};
					fields.id = { type: "string" };
					for (const field of Object.keys(fields)) result[getFieldName({
						model,
						field
					})] = true;
				}
				for (const [joinModel, joinAttr] of Object.entries(join)) {
					const key = getJoinKeyName(model, getModelName(joinModel), schema);
					if (joinAttr.relation === "one-to-one") result[key] = true;
					else result[key] = { take: joinAttr.limit };
				}
			}
			return result;
		};
		/**
		* Build the join key name based on whether the foreign field is unique or not.
		* If unique, use singular. Otherwise, pluralize (add 's').
		*/
		const getJoinKeyName = (baseModel, joinedModel, schema) => {
			try {
				const defaultBaseModelName = getDefaultModelName(baseModel);
				const defaultJoinedModelName = getDefaultModelName(joinedModel);
				const key = getModelName(joinedModel).toLowerCase();
				let foreignKeys = Object.entries(schema[defaultJoinedModelName]?.fields || {}).filter(([_field, fieldAttributes]) => fieldAttributes.references && getDefaultModelName(fieldAttributes.references.model) === defaultBaseModelName);
				if (foreignKeys.length > 0) {
					const [_foreignKey, foreignKeyAttributes] = foreignKeys[0];
					return foreignKeyAttributes?.unique === true || config.usePlural === true ? key : `${key}s`;
				}
				foreignKeys = Object.entries(schema[defaultBaseModelName]?.fields || {}).filter(([_field, fieldAttributes]) => fieldAttributes.references && getDefaultModelName(fieldAttributes.references.model) === defaultJoinedModelName);
				if (foreignKeys.length > 0) return key;
			} catch {}
			return `${getModelName(joinedModel).toLowerCase()}s`;
		};
		function operatorToPrismaOperator(operator) {
			switch (operator) {
				case "starts_with": return "startsWith";
				case "ends_with": return "endsWith";
				case "ne": return "not";
				case "not_in": return "notIn";
				default: return operator;
			}
		}
		const hasRootUniqueWhereCondition = (model, where) => {
			if (!where?.length) return false;
			return where.some((condition) => {
				if (condition.connector === "OR") return false;
				if (condition.operator && condition.operator !== "eq") return false;
				if (condition.mode === "insensitive") {
					const providerSupportsMode = config.provider === "postgresql" || config.provider === "mongodb";
					const isStringValue = typeof condition.value === "string" || Array.isArray(condition.value) && condition.value.every((v) => typeof v === "string");
					if (providerSupportsMode && isStringValue) return false;
				}
				if (condition.field === "id") return true;
				return getFieldAttributes({
					model,
					field: condition.field
				})?.unique === true;
			});
		};
		const convertWhereClause = ({ action, model, where }) => {
			if (!where || !where.length) return {};
			const buildSingleCondition = (w) => {
				const fieldName = getFieldName({
					model,
					field: w.field
				});
				const isInsensitive = (w.mode ?? "sensitive") === "insensitive" && (typeof w.value === "string" || Array.isArray(w.value) && w.value.every((v) => typeof v === "string"));
				const providerSupportsMode = config.provider === "postgresql" || config.provider === "mongodb";
				const prismaMode = isInsensitive && providerSupportsMode ? "insensitive" : void 0;
				const modeFilter = prismaMode ? { mode: prismaMode } : {};
				if (w.operator === "ne" && w.value === null) return getFieldAttributes({
					model,
					field: w.field
				})?.required !== true ? { [fieldName]: { not: null } } : {};
				if ((w.operator === "in" || w.operator === "not_in") && Array.isArray(w.value)) {
					const filtered = w.value.filter((v) => v != null);
					if (filtered.length === 0) if (w.operator === "in") return { AND: [{ [fieldName]: { equals: "__never__" } }, { [fieldName]: { not: "__never__" } }] };
					else return {};
					const prismaOp = operatorToPrismaOperator(w.operator);
					return { [fieldName]: {
						[prismaOp]: filtered,
						...modeFilter
					} };
				}
				if (w.operator === "eq" || !w.operator) return { [fieldName]: {
					equals: w.value,
					...modeFilter
				} };
				if (w.operator === "ne") return { [fieldName]: {
					not: { equals: w.value },
					...modeFilter
				} };
				const prismaOp = operatorToPrismaOperator(w.operator);
				return { [fieldName]: {
					[prismaOp]: w.value,
					...modeFilter
				} };
			};
			if (action === "update") {
				const and = where.filter((w) => w.connector === "AND" || !w.connector);
				const or = where.filter((w) => w.connector === "OR");
				const andSimple = and.filter((w) => w.operator === "eq" || !w.operator);
				const andComplexClause = and.filter((w) => w.operator !== "eq" && w.operator !== void 0).map((w) => buildSingleCondition(w));
				const orClause = or.map((w) => buildSingleCondition(w));
				const result = {};
				for (const w of andSimple) {
					const fieldName = getFieldName({
						model,
						field: w.field
					});
					result[fieldName] = w.value;
				}
				if (andComplexClause.length > 0) result.AND = andComplexClause;
				if (orClause.length > 0) result.OR = orClause;
				return result;
			}
			if (action === "delete") {
				const idCondition = where.find((w) => w.field === "id");
				if (idCondition) {
					const idFieldName = getFieldName({
						model,
						field: "id"
					});
					const remainingWhere = where.filter((w) => w.field !== "id");
					if (remainingWhere.length === 0) return { [idFieldName]: idCondition.value };
					const and = remainingWhere.filter((w) => w.connector === "AND" || !w.connector);
					const or = remainingWhere.filter((w) => w.connector === "OR");
					const andClause = and.map((w) => buildSingleCondition(w));
					const orClause = or.map((w) => buildSingleCondition(w));
					const result = { [idFieldName]: idCondition.value };
					if (andClause.length > 0) result.AND = andClause;
					if (orClause.length > 0) result.OR = orClause;
					return result;
				}
			}
			if (where.length === 1) {
				const w = where[0];
				if (!w) return;
				return buildSingleCondition(w);
			}
			const and = where.filter((w) => w.connector === "AND" || !w.connector);
			const or = where.filter((w) => w.connector === "OR");
			const andClause = and.map((w) => buildSingleCondition(w));
			const orClause = or.map((w) => buildSingleCondition(w));
			return {
				...andClause.length ? { AND: andClause } : {},
				...orClause.length ? { OR: orClause } : {}
			};
		};
		return {
			async create({ model, data: values, select }) {
				if (!db[model]) throw new BetterAuthError(`Model ${model} does not exist in the database. If you haven't generated the Prisma client, you need to run 'npx prisma generate'`);
				return await db[model].create({
					data: values,
					select: convertSelect(select, model)
				});
			},
			async findOne({ model, where, select, join }) {
				const whereClause = convertWhereClause({
					model,
					where,
					action: "findOne"
				});
				if (!db[model]) throw new BetterAuthError(`Model ${model} does not exist in the database. If you haven't generated the Prisma client, you need to run 'npx prisma generate'`);
				const map = /* @__PURE__ */ new Map();
				for (const joinModel of Object.keys(join ?? {})) {
					const key = getJoinKeyName(model, joinModel, schema);
					map.set(key, getModelName(joinModel));
				}
				const selects = convertSelect(select, model, join);
				const result = await db[model].findFirst({
					where: whereClause,
					select: selects
				});
				if (join && result) for (const [includeKey, originalKey] of map.entries()) {
					if (includeKey === originalKey) continue;
					if (includeKey in result) {
						result[originalKey] = result[includeKey];
						delete result[includeKey];
					}
				}
				return result;
			},
			async findMany({ model, where, limit, select, offset, sortBy, join }) {
				const whereClause = convertWhereClause({
					model,
					where,
					action: "findMany"
				});
				if (!db[model]) throw new BetterAuthError(`Model ${model} does not exist in the database. If you haven't generated the Prisma client, you need to run 'npx prisma generate'`);
				const map = /* @__PURE__ */ new Map();
				if (join) for (const [joinModel, _value] of Object.entries(join)) {
					const key = getJoinKeyName(model, joinModel, schema);
					map.set(key, getModelName(joinModel));
				}
				const selects = convertSelect(select, model, join);
				const result = await db[model].findMany({
					where: whereClause,
					take: limit || 100,
					skip: offset || 0,
					...sortBy?.field ? { orderBy: { [getFieldName({
						model,
						field: sortBy.field
					})]: sortBy.direction === "desc" ? "desc" : "asc" } } : {},
					select: selects
				});
				if (join && Array.isArray(result)) for (const item of result) for (const [includeKey, originalKey] of map.entries()) {
					if (includeKey === originalKey) continue;
					if (includeKey in item) {
						item[originalKey] = item[includeKey];
						delete item[includeKey];
					}
				}
				return result;
			},
			async count({ model, where }) {
				const whereClause = convertWhereClause({
					model,
					where,
					action: "count"
				});
				if (!db[model]) throw new BetterAuthError(`Model ${model} does not exist in the database. If you haven't generated the Prisma client, you need to run 'npx prisma generate'`);
				return await db[model].count({ where: whereClause });
			},
			async update({ model, where, update }) {
				if (!db[model]) throw new BetterAuthError(`Model ${model} does not exist in the database. If you haven't generated the Prisma client, you need to run 'npx prisma generate'`);
				if (!hasRootUniqueWhereCondition(model, where)) {
					const whereClause = convertWhereClause({
						model,
						where,
						action: "updateMany"
					});
					if (!(await db[model].updateMany({
						where: whereClause,
						data: update
					}))?.count) return null;
					return await db[model].findFirst({ where: whereClause });
				}
				const whereClause = convertWhereClause({
					model,
					where,
					action: "update"
				});
				return await db[model].update({
					where: whereClause,
					data: update
				});
			},
			async updateMany({ model, where, update }) {
				if (!db[model]) throw new BetterAuthError(`Model ${model} does not exist in the database. If you haven't generated the Prisma client, you need to run 'npx prisma generate'`);
				const whereClause = convertWhereClause({
					model,
					where,
					action: "updateMany"
				});
				const result = await db[model].updateMany({
					where: whereClause,
					data: update
				});
				return result ? result.count : 0;
			},
			async delete({ model, where }) {
				if (!db[model]) throw new BetterAuthError(`Model ${model} does not exist in the database. If you haven't generated the Prisma client, you need to run 'npx prisma generate'`);
				if (!where?.some((w) => w.field === "id")) {
					const whereClause = convertWhereClause({
						model,
						where,
						action: "deleteMany"
					});
					await db[model].deleteMany({ where: whereClause });
					return;
				}
				const whereClause = convertWhereClause({
					model,
					where,
					action: "delete"
				});
				try {
					await db[model].delete({ where: whereClause });
				} catch (e) {
					if (e?.meta?.cause === "Record to delete does not exist.") return;
					if (e?.code === "P2025") return;
					console.log(e);
				}
			},
			async deleteMany({ model, where }) {
				const whereClause = convertWhereClause({
					model,
					where,
					action: "deleteMany"
				});
				const result = await db[model].deleteMany({ where: whereClause });
				return result ? result.count : 0;
			},
			options: config
		};
	};
	let adapterOptions = null;
	adapterOptions = {
		config: {
			adapterId: "prisma",
			adapterName: "Prisma Adapter",
			usePlural: config.usePlural ?? false,
			debugLogs: config.debugLogs ?? false,
			supportsUUIDs: config.provider === "postgresql" ? true : false,
			supportsArrays: config.provider === "postgresql" || config.provider === "mongodb" ? true : false,
			transaction: config.transaction ?? false ? (cb) => prisma.$transaction((tx) => {
				return cb(createAdapterFactory({
					config: adapterOptions.config,
					adapter: createCustomAdapter(tx)
				})(lazyOptions));
			}) : false
		},
		adapter: createCustomAdapter(prisma)
	};
	const adapter = createAdapterFactory(adapterOptions);
	return (options) => {
		lazyOptions = options;
		return adapter(options);
	};
};
//#endregion
export { prismaAdapter };

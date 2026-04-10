import { createAdapterFactory } from "@better-auth/core/db/adapter";
import { ObjectId, UUID } from "mongodb";
//#region src/query-builders.ts
/**
* Escape special regex characters for safe use in MongoDB $regex.
* @see https://www.pcre.org/original/doc/html/pcrepattern.html
*/
function escapeForMongoRegex(input, maxLength = 256) {
	if (typeof input !== "string") return "";
	return input.slice(0, maxLength).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
/**
* Case-insensitive equality using $regex.
*/
function insensitiveEq(field, value) {
	return { [field]: {
		$regex: `^${escapeForMongoRegex(value)}$`,
		$options: "i"
	} };
}
/**
* Case-insensitive IN using $or with regex for each value.
*/
function insensitiveIn(field, values) {
	if (values.length === 0) return { $expr: { $eq: [1, 0] } };
	return { $or: values.map((v) => ({ [field]: {
		$regex: `^${escapeForMongoRegex(v)}$`,
		$options: "i"
	} })) };
}
/**
* Case-insensitive NOT IN using $nor.
*/
function insensitiveNotIn(field, values) {
	if (values.length === 0) return {};
	return { $nor: values.map((v) => ({ [field]: {
		$regex: `^${escapeForMongoRegex(v)}$`,
		$options: "i"
	} })) };
}
/**
* Case-insensitive inequality using $not + $regex.
*/
function insensitiveNe(field, value) {
	return { [field]: { $not: {
		$regex: `^${escapeForMongoRegex(value)}$`,
		$options: "i"
	} } };
}
/**
* Case-insensitive contains (LIKE %value%).
*/
function insensitiveContains(field, value) {
	return { [field]: {
		$regex: `.*${escapeForMongoRegex(value)}.*`,
		$options: "i"
	} };
}
/**
* Case-insensitive starts_with (LIKE value%).
*/
function insensitiveStartsWith(field, value) {
	return { [field]: {
		$regex: `^${escapeForMongoRegex(value)}`,
		$options: "i"
	} };
}
/**
* Case-insensitive ends_with (LIKE %value).
*/
function insensitiveEndsWith(field, value) {
	return { [field]: {
		$regex: `${escapeForMongoRegex(value)}$`,
		$options: "i"
	} };
}
//#endregion
//#region src/mongodb-adapter.ts
var MongoAdapterError = class extends Error {
	constructor(code, message) {
		super(message);
		this.code = code;
		this.name = "MongoAdapterError";
	}
};
const mongodbAdapter = (db, config) => {
	let lazyOptions;
	const getCustomIdGenerator = (options) => {
		const generator = options.advanced?.database?.generateId;
		if (typeof generator === "function") return generator;
	};
	const createCustomAdapter = (db, session) => ({ getFieldAttributes, getFieldName, schema, getDefaultModelName, options }) => {
		const customIdGen = getCustomIdGenerator(options);
		const useUUIDs = options.advanced?.database?.generateId === "uuid";
		function coerceToIdType(value) {
			if (useUUIDs) return new UUID(value);
			return new ObjectId(value);
		}
		function isIdInstance(value) {
			if (useUUIDs) return value instanceof UUID;
			return value instanceof ObjectId;
		}
		function serializeID({ field, value, model }) {
			if (customIdGen) return value;
			model = getDefaultModelName(model);
			if (field === "id" || field === "_id" || schema[model].fields[field]?.references?.field === "id") {
				if (value === null || value === void 0) return value;
				if (typeof value !== "string") {
					if (isIdInstance(value)) return value;
					if (Array.isArray(value)) return value.map((v) => {
						if (v === null || v === void 0) return v;
						if (typeof v === "string") try {
							return coerceToIdType(v);
						} catch {
							return v;
						}
						if (isIdInstance(v)) return v;
						throw new MongoAdapterError("INVALID_ID", "Invalid id value");
					});
					throw new MongoAdapterError("INVALID_ID", "Invalid id value");
				}
				try {
					return coerceToIdType(value);
				} catch {
					return value;
				}
			}
			return value;
		}
		function convertWhereClause({ where, model }) {
			if (!where.length) return {};
			const conditions = where.map((w) => {
				const { field: field_, value, operator = "eq", connector = "AND", mode = "sensitive" } = w;
				let condition;
				let field = getFieldName({
					model,
					field: field_
				});
				if (field === "id") field = "_id";
				const fieldAttributes = getFieldAttributes({
					model,
					field: field_
				});
				const isInsensitive = !(field === "_id" || fieldAttributes?.references?.field === "id") && mode === "insensitive" && (typeof value === "string" || Array.isArray(value) && value.every((v) => typeof v === "string"));
				switch (operator.toLowerCase()) {
					case "eq":
						if (isInsensitive && typeof value === "string") condition = insensitiveEq(field, value);
						else condition = { [field]: serializeID({
							field,
							value,
							model
						}) };
						break;
					case "in":
						if (isInsensitive && Array.isArray(value)) condition = insensitiveIn(field, value);
						else condition = { [field]: { $in: Array.isArray(value) ? value.map((v) => serializeID({
							field,
							value: v,
							model
						})) : [serializeID({
							field,
							value,
							model
						})] } };
						break;
					case "not_in":
						if (isInsensitive && Array.isArray(value)) condition = insensitiveNotIn(field, value);
						else condition = { [field]: { $nin: Array.isArray(value) ? value.map((v) => serializeID({
							field,
							value: v,
							model
						})) : [serializeID({
							field,
							value,
							model
						})] } };
						break;
					case "gt":
						condition = { [field]: { $gt: serializeID({
							field,
							value,
							model
						}) } };
						break;
					case "gte":
						condition = { [field]: { $gte: serializeID({
							field,
							value,
							model
						}) } };
						break;
					case "lt":
						condition = { [field]: { $lt: serializeID({
							field,
							value,
							model
						}) } };
						break;
					case "lte":
						condition = { [field]: { $lte: serializeID({
							field,
							value,
							model
						}) } };
						break;
					case "ne":
						if (isInsensitive && typeof value === "string") condition = insensitiveNe(field, value);
						else condition = { [field]: { $ne: serializeID({
							field,
							value,
							model
						}) } };
						break;
					case "contains":
						condition = isInsensitive ? insensitiveContains(field, value) : { [field]: { $regex: `.*${escapeForMongoRegex(value)}.*` } };
						break;
					case "starts_with":
						condition = isInsensitive ? insensitiveStartsWith(field, value) : { [field]: { $regex: `^${escapeForMongoRegex(value)}` } };
						break;
					case "ends_with":
						condition = isInsensitive ? insensitiveEndsWith(field, value) : { [field]: { $regex: `${escapeForMongoRegex(value)}$` } };
						break;
					default: throw new MongoAdapterError("UNSUPPORTED_OPERATOR", `Unsupported operator: ${operator}`);
				}
				return {
					condition,
					connector
				};
			});
			if (conditions.length === 1) return conditions[0].condition;
			const andConditions = conditions.filter((c) => c.connector === "AND").map((c) => c.condition);
			const orConditions = conditions.filter((c) => c.connector === "OR").map((c) => c.condition);
			let clause = {};
			if (andConditions.length) clause = {
				...clause,
				$and: andConditions
			};
			if (orConditions.length) clause = {
				...clause,
				$or: orConditions
			};
			return clause;
		}
		return {
			async create({ model, data: values }) {
				return {
					_id: (await db.collection(model).insertOne(values, { session })).insertedId.toString(),
					...values
				};
			},
			async findOne({ model, where, select, join }) {
				const pipeline = [where ? { $match: convertWhereClause({
					where,
					model
				}) } : { $match: {} }];
				if (join) for (const [joinedModel, joinConfig] of Object.entries(join)) {
					const localField = getFieldName({
						field: joinConfig.on.from,
						model
					});
					const foreignField = getFieldName({
						field: joinConfig.on.to,
						model: joinedModel
					});
					const localFieldName = localField === "id" ? "_id" : localField;
					const foreignFieldName = foreignField === "id" ? "_id" : foreignField;
					const isUnique = (schema[getDefaultModelName(joinedModel)]?.fields[joinConfig.on.to])?.unique === true;
					const shouldLimit = !isUnique && joinConfig.limit !== void 0;
					const limit = joinConfig.limit ?? options.advanced?.database?.defaultFindManyLimit ?? 100;
					if (shouldLimit && limit > 0) {
						const foreignFieldRef = `$${foreignFieldName}`;
						pipeline.push({ $lookup: {
							from: joinedModel,
							let: { localFieldValue: `$${localFieldName}` },
							pipeline: [{ $match: { $expr: { $eq: [foreignFieldRef, "$$localFieldValue"] } } }, { $limit: limit }],
							as: joinedModel
						} });
					} else pipeline.push({ $lookup: {
						from: joinedModel,
						localField: localFieldName,
						foreignField: foreignFieldName,
						as: joinedModel
					} });
					if (isUnique) pipeline.push({ $unwind: {
						path: `$${joinedModel}`,
						preserveNullAndEmptyArrays: true
					} });
				}
				if (select) {
					const projection = {};
					select.forEach((field) => {
						projection[getFieldName({
							field,
							model
						})] = 1;
					});
					if (join) for (const joinedModel of Object.keys(join)) projection[joinedModel] = 1;
					pipeline.push({ $project: projection });
				}
				pipeline.push({ $limit: 1 });
				const res = await db.collection(model).aggregate(pipeline, { session }).toArray();
				if (!res || res.length === 0) return null;
				return res[0];
			},
			async findMany({ model, where, limit, select, offset, sortBy, join }) {
				const pipeline = [where ? { $match: convertWhereClause({
					where,
					model
				}) } : { $match: {} }];
				if (join) for (const [joinedModel, joinConfig] of Object.entries(join)) {
					const localField = getFieldName({
						field: joinConfig.on.from,
						model
					});
					const foreignField = getFieldName({
						field: joinConfig.on.to,
						model: joinedModel
					});
					const localFieldName = localField === "id" ? "_id" : localField;
					const foreignFieldName = foreignField === "id" ? "_id" : foreignField;
					const isUnique = getFieldAttributes({
						model: joinedModel,
						field: joinConfig.on.to
					})?.unique === true;
					const shouldLimit = joinConfig.relation !== "one-to-one" && joinConfig.limit !== void 0;
					const limit = joinConfig.limit ?? options.advanced?.database?.defaultFindManyLimit ?? 100;
					if (shouldLimit && limit > 0) {
						const foreignFieldRef = `$${foreignFieldName}`;
						pipeline.push({ $lookup: {
							from: joinedModel,
							let: { localFieldValue: `$${localFieldName}` },
							pipeline: [{ $match: { $expr: { $eq: [foreignFieldRef, "$$localFieldValue"] } } }, { $limit: limit }],
							as: joinedModel
						} });
					} else pipeline.push({ $lookup: {
						from: joinedModel,
						localField: localFieldName,
						foreignField: foreignFieldName,
						as: joinedModel
					} });
					if (isUnique) pipeline.push({ $unwind: {
						path: `$${joinedModel}`,
						preserveNullAndEmptyArrays: true
					} });
				}
				if (select?.length && select.length > 0) {
					const projection = {};
					select.forEach((field) => {
						projection[getFieldName({
							field,
							model
						})] = 1;
					});
					if (join) for (const joinedModel of Object.keys(join)) projection[joinedModel] = 1;
					pipeline.push({ $project: projection });
				}
				if (sortBy) pipeline.push({ $sort: { [getFieldName({
					field: sortBy.field,
					model
				})]: sortBy.direction === "desc" ? -1 : 1 } });
				if (offset) pipeline.push({ $skip: offset });
				if (limit) pipeline.push({ $limit: limit });
				return await db.collection(model).aggregate(pipeline, { session }).toArray();
			},
			async count({ model, where }) {
				const pipeline = [where ? { $match: convertWhereClause({
					where,
					model
				}) } : { $match: {} }, { $count: "total" }];
				const res = await db.collection(model).aggregate(pipeline, { session }).toArray();
				if (!res || res.length === 0) return 0;
				return res[0]?.total ?? 0;
			},
			async update({ model, where, update: values }) {
				const clause = convertWhereClause({
					where,
					model
				});
				const doc = (await db.collection(model).findOneAndUpdate(clause, { $set: values }, {
					session,
					returnDocument: "after",
					includeResultMetadata: true
				}))?.value ?? null;
				if (!doc) return null;
				return doc;
			},
			async updateMany({ model, where, update: values }) {
				const clause = convertWhereClause({
					where,
					model
				});
				return (await db.collection(model).updateMany(clause, { $set: values }, { session })).modifiedCount;
			},
			async delete({ model, where }) {
				const clause = convertWhereClause({
					where,
					model
				});
				await db.collection(model).deleteOne(clause, { session });
			},
			async deleteMany({ model, where }) {
				const clause = convertWhereClause({
					where,
					model
				});
				return (await db.collection(model).deleteMany(clause, { session })).deletedCount;
			}
		};
	};
	let lazyAdapter = null;
	let adapterOptions = null;
	adapterOptions = {
		config: {
			adapterId: "mongodb-adapter",
			adapterName: "MongoDB Adapter",
			usePlural: config?.usePlural ?? false,
			debugLogs: config?.debugLogs ?? false,
			mapKeysTransformInput: { id: "_id" },
			mapKeysTransformOutput: { _id: "id" },
			supportsArrays: true,
			supportsNumericIds: false,
			transaction: config?.client && (config?.transaction ?? true) ? async (cb) => {
				if (!config.client) return cb(lazyAdapter(lazyOptions));
				const session = config.client.startSession();
				try {
					session.startTransaction();
					const result = await cb(createAdapterFactory({
						config: adapterOptions.config,
						adapter: createCustomAdapter(db, session)
					})(lazyOptions));
					await session.commitTransaction();
					return result;
				} catch (err) {
					await session.abortTransaction();
					throw err;
				} finally {
					await session.endSession();
				}
			} : false,
			customTransformInput({ action, data, field, fieldAttributes, schema, model, options }) {
				const customIdGen = getCustomIdGenerator(options);
				if (field === "_id" || fieldAttributes.references?.field === "id") {
					if (customIdGen) return data;
					if (action !== "create" && action !== "update") return data;
					const IdClass = options.advanced?.database?.generateId === "uuid" ? UUID : ObjectId;
					if (data instanceof IdClass) return data;
					if (Array.isArray(data)) return data.map((v) => {
						if (typeof v === "string") try {
							return new IdClass(v);
						} catch {
							return v;
						}
						return v;
					});
					if (typeof data === "string") try {
						return new IdClass(data);
					} catch {
						return data;
					}
					if (fieldAttributes?.references?.field === "id" && !fieldAttributes?.required && data === null) return null;
					if (action === "update") return data;
					return new IdClass();
				}
				return data;
			},
			customTransformOutput({ data, field, fieldAttributes }) {
				if (field === "id" || fieldAttributes.references?.field === "id") {
					if (data instanceof UUID) return data.toString();
					if (data instanceof ObjectId) return data.toHexString();
					if (Array.isArray(data)) return data.map((v) => {
						if (v instanceof UUID) return v.toString();
						if (v instanceof ObjectId) return v.toHexString();
						return v;
					});
					return data;
				}
				return data;
			},
			customIdGenerator() {
				return new ObjectId().toString();
			}
		},
		adapter: createCustomAdapter(db)
	};
	lazyAdapter = createAdapterFactory(adapterOptions);
	return (options) => {
		lazyOptions = options;
		return lazyAdapter(options);
	};
};
//#endregion
export { mongodbAdapter };

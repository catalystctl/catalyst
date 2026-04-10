import { Kysely, MssqlDialect, MysqlDialect, PostgresDialect, SqliteDialect, sql } from "kysely";
import { createAdapterFactory } from "@better-auth/core/db/adapter";
import { capitalizeFirstLetter } from "@better-auth/core/utils/string";
//#region src/dialect.ts
function getKyselyDatabaseType(db) {
	if (!db) return null;
	if ("dialect" in db) return getKyselyDatabaseType(db.dialect);
	if ("createDriver" in db) {
		if (db instanceof SqliteDialect) return "sqlite";
		if (db instanceof MysqlDialect) return "mysql";
		if (db instanceof PostgresDialect) return "postgres";
		if (db instanceof MssqlDialect) return "mssql";
	}
	if ("aggregate" in db) return "sqlite";
	if ("getConnection" in db) return "mysql";
	if ("connect" in db) return "postgres";
	if ("fileControl" in db) return "sqlite";
	if ("open" in db && "close" in db && "prepare" in db) return "sqlite";
	if ("batch" in db && "exec" in db && "prepare" in db) return "sqlite";
	return null;
}
const createKyselyAdapter = async (config) => {
	const db = config.database;
	if (!db) return {
		kysely: null,
		databaseType: null,
		transaction: void 0
	};
	if ("db" in db) return {
		kysely: db.db,
		databaseType: db.type,
		transaction: db.transaction
	};
	if ("dialect" in db) return {
		kysely: new Kysely({ dialect: db.dialect }),
		databaseType: db.type,
		transaction: db.transaction
	};
	let dialect = void 0;
	const databaseType = getKyselyDatabaseType(db);
	if ("createDriver" in db) dialect = db;
	if ("aggregate" in db && !("createSession" in db)) dialect = new SqliteDialect({ database: db });
	if ("getConnection" in db) dialect = new MysqlDialect(db);
	if ("connect" in db) dialect = new PostgresDialect({ pool: db });
	if ("fileControl" in db) {
		const { BunSqliteDialect } = await import("./bun-sqlite-dialect-na--YwnN.mjs");
		dialect = new BunSqliteDialect({ database: db });
	}
	if ("createSession" in db) {
		let DatabaseSync = void 0;
		try {
			const nodeSqlite = "node:sqlite";
			({DatabaseSync} = await import(
				/* @vite-ignore */
				/* webpackIgnore: true */
				nodeSqlite
));
		} catch (error) {
			if (error !== null && typeof error === "object" && "code" in error && error.code !== "ERR_UNKNOWN_BUILTIN_MODULE") throw error;
		}
		if (DatabaseSync && db instanceof DatabaseSync) {
			const { NodeSqliteDialect } = await import("./node-sqlite-dialect.mjs");
			dialect = new NodeSqliteDialect({ database: db });
		}
	}
	if ("batch" in db && "exec" in db && "prepare" in db) {
		const { D1SqliteDialect } = await import("./d1-sqlite-dialect-C2B7YsIT.mjs");
		dialect = new D1SqliteDialect({ database: db });
	}
	return {
		kysely: dialect ? new Kysely({ dialect }) : null,
		databaseType,
		transaction: void 0
	};
};
//#endregion
//#region src/query-builders.ts
/**
* Case-insensitive ILIKE/LIKE for pattern matching.
* Uses ILIKE on PostgreSQL, LOWER()+LIKE on MySQL/SQLite/MSSQL.
*/
function insensitiveIlike(columnRef, pattern, dbType) {
	return dbType === "postgres" ? sql`${sql.ref(columnRef)} ILIKE ${pattern}` : sql`LOWER(${sql.ref(columnRef)}) LIKE LOWER(${pattern})`;
}
/**
* Case-insensitive IN for string arrays.
* Returns { lhs, values } for use with eb(lhs, "in", values).
*/
function insensitiveIn(columnRef, values) {
	return {
		lhs: sql`LOWER(${sql.ref(columnRef)})`,
		values: values.map((v) => v.toLowerCase())
	};
}
/**
* Case-insensitive NOT IN for string arrays.
*/
function insensitiveNotIn(columnRef, values) {
	return {
		lhs: sql`LOWER(${sql.ref(columnRef)})`,
		values: values.map((v) => v.toLowerCase())
	};
}
/**
* Case-insensitive equality for strings.
* Returns { lhs, value } for use with eb(lhs, "=", value).
*/
function insensitiveEq(columnRef, value) {
	return {
		lhs: sql`LOWER(${sql.ref(columnRef)})`,
		value: value.toLowerCase()
	};
}
/**
* Case-insensitive inequality for strings.
*/
function insensitiveNe(columnRef, value) {
	return {
		lhs: sql`LOWER(${sql.ref(columnRef)})`,
		value: value.toLowerCase()
	};
}
//#endregion
//#region src/kysely-adapter.ts
const kyselyAdapter = (db, config) => {
	let lazyOptions = null;
	const createCustomAdapter = (db) => {
		return ({ getFieldName, schema, getDefaultFieldName, getDefaultModelName, getFieldAttributes, getModelName }) => {
			const selectAllJoins = (join) => {
				const allSelects = [];
				const allSelectsStr = [];
				if (join) for (const [joinModel, _] of Object.entries(join)) {
					const fields = schema[getDefaultModelName(joinModel)]?.fields;
					const [_joinModelSchema, joinModelName] = joinModel.includes(".") ? joinModel.split(".") : [void 0, joinModel];
					if (!fields) continue;
					fields.id = { type: "string" };
					for (const [field, fieldAttr] of Object.entries(fields)) {
						allSelects.push(sql`${sql.ref(`join_${joinModelName}`)}.${sql.ref(fieldAttr.fieldName || field)} as ${sql.ref(`_joined_${joinModelName}_${fieldAttr.fieldName || field}`)}`);
						allSelectsStr.push({
							joinModel,
							joinModelRef: joinModelName,
							fieldName: fieldAttr.fieldName || field
						});
					}
				}
				return {
					allSelectsStr,
					allSelects
				};
			};
			const withReturning = async (values, builder, model, where) => {
				let res;
				if (config?.type === "mysql") {
					await builder.execute();
					const field = values.id ? "id" : where.length > 0 && where[0]?.field ? where[0].field : "id";
					if (!values.id && where.length === 0) {
						res = await db.selectFrom(model).selectAll().orderBy(getFieldName({
							model,
							field
						}), "desc").limit(1).executeTakeFirst();
						return res;
					}
					const value = values[field] !== void 0 ? values[field] : where[0]?.value;
					res = await db.selectFrom(model).selectAll().orderBy(getFieldName({
						model,
						field
					}), "desc").where(getFieldName({
						model,
						field
					}), value === null ? "is" : "=", value).limit(1).executeTakeFirst();
					return res;
				}
				if (config?.type === "mssql") {
					res = await builder.outputAll("inserted").executeTakeFirst();
					return res;
				}
				res = await builder.returningAll().executeTakeFirst();
				return res;
			};
			function convertWhereClause(model, w) {
				if (!w) return {
					and: null,
					or: null
				};
				const conditions = {
					and: [],
					or: []
				};
				w.forEach((condition) => {
					const { field: _field, value: _value, operator = "eq", connector = "AND", mode = "sensitive" } = condition;
					const value = _value;
					const field = getFieldName({
						model,
						field: _field
					});
					const isInsensitive = mode === "insensitive" && (typeof value === "string" || Array.isArray(value) && value.every((v) => typeof v === "string"));
					const expr = (eb) => {
						const f = `${model}.${field}`;
						if (operator.toLowerCase() === "in") {
							if (isInsensitive) {
								const { lhs, values } = insensitiveIn(f, Array.isArray(value) ? value : [value]);
								return eb(lhs, "in", values);
							}
							return eb(f, "in", Array.isArray(value) ? value : [value]);
						}
						if (operator.toLowerCase() === "not_in") {
							if (isInsensitive) {
								const { lhs, values } = insensitiveNotIn(f, Array.isArray(value) ? value : [value]);
								return eb(lhs, "not in", values);
							}
							return eb(f, "not in", Array.isArray(value) ? value : [value]);
						}
						if (operator === "contains") {
							if (isInsensitive && typeof value === "string") return insensitiveIlike(f, `%${value}%`, config?.type);
							return eb(f, "like", `%${value}%`);
						}
						if (operator === "starts_with") {
							if (isInsensitive && typeof value === "string") return insensitiveIlike(f, `${value}%`, config?.type);
							return eb(f, "like", `${value}%`);
						}
						if (operator === "ends_with") {
							if (isInsensitive && typeof value === "string") return insensitiveIlike(f, `%${value}`, config?.type);
							return eb(f, "like", `%${value}`);
						}
						if (operator === "eq") {
							if (value === null) return eb(f, "is", null);
							if (isInsensitive && typeof value === "string") {
								const { lhs, value: v } = insensitiveEq(f, value);
								return eb(lhs, "=", v);
							}
							return eb(f, "=", value);
						}
						if (operator === "ne") {
							if (value === null) return eb(f, "is not", null);
							if (isInsensitive && typeof value === "string") {
								const { lhs, value: v } = insensitiveNe(f, value);
								return eb(lhs, "<>", v);
							}
							return eb(f, "<>", value);
						}
						if (operator === "gt") return eb(f, ">", value);
						if (operator === "gte") return eb(f, ">=", value);
						if (operator === "lt") return eb(f, "<", value);
						if (operator === "lte") return eb(f, "<=", value);
						return eb(f, operator, value);
					};
					if (connector === "OR") conditions.or.push(expr);
					else conditions.and.push(expr);
				});
				return {
					and: conditions.and.length ? conditions.and : null,
					or: conditions.or.length ? conditions.or : null
				};
			}
			function processJoinedResults(rows, joinConfig, allSelectsStr) {
				if (!joinConfig || !rows.length) return rows;
				const groupedByMainId = /* @__PURE__ */ new Map();
				for (const currentRow of rows) {
					const mainModelFields = {};
					const joinedModelFields = {};
					for (const [joinModel] of Object.entries(joinConfig)) joinedModelFields[getModelName(joinModel)] = {};
					for (const [key, value] of Object.entries(currentRow)) {
						const keyStr = String(key);
						let assigned = false;
						for (const { joinModel, fieldName, joinModelRef } of allSelectsStr) if (keyStr === `_joined_${joinModelRef}_${fieldName}` || keyStr === `_Joined${capitalizeFirstLetter(joinModelRef)}${capitalizeFirstLetter(fieldName)}`) {
							joinedModelFields[getModelName(joinModel)][getFieldName({
								model: joinModel,
								field: fieldName
							})] = value;
							assigned = true;
							break;
						}
						if (!assigned) mainModelFields[key] = value;
					}
					const mainId = mainModelFields.id;
					if (!mainId) continue;
					if (!groupedByMainId.has(mainId)) {
						const entry = { ...mainModelFields };
						for (const [joinModel, joinAttr] of Object.entries(joinConfig)) entry[getModelName(joinModel)] = joinAttr.relation === "one-to-one" ? null : [];
						groupedByMainId.set(mainId, entry);
					}
					const entry = groupedByMainId.get(mainId);
					for (const [joinModel, joinAttr] of Object.entries(joinConfig)) {
						const isUnique = joinAttr.relation === "one-to-one";
						const limit = joinAttr.limit ?? 100;
						const joinedObj = joinedModelFields[getModelName(joinModel)];
						const hasData = joinedObj && Object.keys(joinedObj).length > 0 && Object.values(joinedObj).some((value) => value !== null && value !== void 0);
						if (isUnique) entry[getModelName(joinModel)] = hasData ? joinedObj : null;
						else {
							const joinModelName = getModelName(joinModel);
							if (Array.isArray(entry[joinModelName]) && hasData) {
								if (entry[joinModelName].length >= limit) continue;
								const idFieldName = getFieldName({
									model: joinModel,
									field: "id"
								});
								const joinedId = joinedObj[idFieldName];
								if (joinedId) {
									if (!entry[joinModelName].some((item) => item[idFieldName] === joinedId) && entry[joinModelName].length < limit) entry[joinModelName].push(joinedObj);
								} else if (entry[joinModelName].length < limit) entry[joinModelName].push(joinedObj);
							}
						}
					}
				}
				const result = Array.from(groupedByMainId.values());
				for (const entry of result) for (const [joinModel, joinAttr] of Object.entries(joinConfig)) if (joinAttr.relation !== "one-to-one") {
					const joinModelName = getModelName(joinModel);
					if (Array.isArray(entry[joinModelName])) {
						const limit = joinAttr.limit ?? 100;
						if (entry[joinModelName].length > limit) entry[joinModelName] = entry[joinModelName].slice(0, limit);
					}
				}
				return result;
			}
			return {
				async create({ data, model }) {
					return await withReturning(data, db.insertInto(model).values(data), model, []);
				},
				async findOne({ model, where, select, join }) {
					const { and, or } = convertWhereClause(model, where);
					let query = db.selectFrom((eb) => {
						let b = eb.selectFrom(model);
						if (and) b = b.where((eb) => eb.and(and.map((expr) => expr(eb))));
						if (or) b = b.where((eb) => eb.or(or.map((expr) => expr(eb))));
						if (select?.length && select.length > 0) b = b.select(select.map((field) => getFieldName({
							model,
							field
						})));
						else b = b.selectAll();
						return b.as("primary");
					}).selectAll("primary");
					if (join) for (const [joinModel, joinAttr] of Object.entries(join)) {
						const [_joinModelSchema, joinModelName] = joinModel.includes(".") ? joinModel.split(".") : [void 0, joinModel];
						query = query.leftJoin(`${joinModel} as join_${joinModelName}`, (join) => join.onRef(`join_${joinModelName}.${joinAttr.on.to}`, "=", `primary.${joinAttr.on.from}`));
					}
					const { allSelectsStr, allSelects } = selectAllJoins(join);
					query = query.select(allSelects);
					const res = await query.execute();
					if (!res || !Array.isArray(res) || res.length === 0) return null;
					const row = res[0];
					if (join) return processJoinedResults(res, join, allSelectsStr)[0];
					return row;
				},
				async findMany({ model, where, limit, select, offset, sortBy, join }) {
					const { and, or } = convertWhereClause(model, where);
					let query = db.selectFrom((eb) => {
						let b = eb.selectFrom(model);
						if (config?.type === "mssql") {
							if (offset !== void 0) {
								if (!sortBy) b = b.orderBy(getFieldName({
									model,
									field: "id"
								}));
								b = b.offset(offset).fetch(limit || 100);
							} else if (limit !== void 0) b = b.top(limit);
						} else {
							if (limit !== void 0) b = b.limit(limit);
							if (offset !== void 0) b = b.offset(offset);
						}
						if (sortBy?.field) b = b.orderBy(`${getFieldName({
							model,
							field: sortBy.field
						})}`, sortBy.direction);
						if (and) b = b.where((eb) => eb.and(and.map((expr) => expr(eb))));
						if (or) b = b.where((eb) => eb.or(or.map((expr) => expr(eb))));
						if (select?.length && select.length > 0) b = b.select(select.map((field) => getFieldName({
							model,
							field
						})));
						else b = b.selectAll();
						return b.as("primary");
					}).selectAll("primary");
					if (join) for (const [joinModel, joinAttr] of Object.entries(join)) {
						const [_joinModelSchema, joinModelName] = joinModel.includes(".") ? joinModel.split(".") : [void 0, joinModel];
						query = query.leftJoin(`${joinModel} as join_${joinModelName}`, (join) => join.onRef(`join_${joinModelName}.${joinAttr.on.to}`, "=", `primary.${joinAttr.on.from}`));
					}
					const { allSelectsStr, allSelects } = selectAllJoins(join);
					query = query.select(allSelects);
					if (sortBy?.field) query = query.orderBy(`${getFieldName({
						model,
						field: sortBy.field
					})}`, sortBy.direction);
					const res = await query.execute();
					if (!res) return [];
					if (join) return processJoinedResults(res, join, allSelectsStr);
					return res;
				},
				async update({ model, where, update: values }) {
					const { and, or } = convertWhereClause(model, where);
					let query = db.updateTable(model).set(values);
					if (and) query = query.where((eb) => eb.and(and.map((expr) => expr(eb))));
					if (or) query = query.where((eb) => eb.or(or.map((expr) => expr(eb))));
					return await withReturning(values, query, model, where);
				},
				async updateMany({ model, where, update: values }) {
					const { and, or } = convertWhereClause(model, where);
					let query = db.updateTable(model).set(values);
					if (and) query = query.where((eb) => eb.and(and.map((expr) => expr(eb))));
					if (or) query = query.where((eb) => eb.or(or.map((expr) => expr(eb))));
					const res = (await query.executeTakeFirst()).numUpdatedRows;
					return res > Number.MAX_SAFE_INTEGER ? Number.MAX_SAFE_INTEGER : Number(res);
				},
				async count({ model, where }) {
					const { and, or } = convertWhereClause(model, where);
					let query = db.selectFrom(model).select(db.fn.count("id").as("count"));
					if (and) query = query.where((eb) => eb.and(and.map((expr) => expr(eb))));
					if (or) query = query.where((eb) => eb.or(or.map((expr) => expr(eb))));
					const res = await query.execute();
					if (typeof res[0].count === "number") return res[0].count;
					if (typeof res[0].count === "bigint") return Number(res[0].count);
					return parseInt(res[0].count);
				},
				async delete({ model, where }) {
					const { and, or } = convertWhereClause(model, where);
					let query = db.deleteFrom(model);
					if (and) query = query.where((eb) => eb.and(and.map((expr) => expr(eb))));
					if (or) query = query.where((eb) => eb.or(or.map((expr) => expr(eb))));
					await query.execute();
				},
				async deleteMany({ model, where }) {
					const { and, or } = convertWhereClause(model, where);
					let query = db.deleteFrom(model);
					if (and) query = query.where((eb) => eb.and(and.map((expr) => expr(eb))));
					if (or) query = query.where((eb) => eb.or(or.map((expr) => expr(eb))));
					const res = (await query.executeTakeFirst()).numDeletedRows;
					return res > Number.MAX_SAFE_INTEGER ? Number.MAX_SAFE_INTEGER : Number(res);
				},
				options: config
			};
		};
	};
	let adapterOptions = null;
	adapterOptions = {
		config: {
			adapterId: "kysely",
			adapterName: "Kysely Adapter",
			usePlural: config?.usePlural,
			debugLogs: config?.debugLogs,
			supportsBooleans: config?.type === "sqlite" || config?.type === "mssql" || config?.type === "mysql" || !config?.type ? false : true,
			supportsDates: config?.type === "sqlite" || config?.type === "mssql" || !config?.type ? false : true,
			supportsJSON: config?.type === "postgres" ? true : false,
			supportsArrays: false,
			supportsUUIDs: config?.type === "postgres" ? true : false,
			transaction: config?.transaction ? (cb) => db.transaction().execute((trx) => {
				return cb(createAdapterFactory({
					config: adapterOptions.config,
					adapter: createCustomAdapter(trx)
				})(lazyOptions));
			}) : false
		},
		adapter: createCustomAdapter(db)
	};
	const adapter = createAdapterFactory(adapterOptions);
	return (options) => {
		lazyOptions = options;
		return adapter(options);
	};
};
//#endregion
export { createKyselyAdapter, getKyselyDatabaseType, kyselyAdapter };

import { getCurrentAdapter, getCurrentAuthContext, queueAfterTransactionHook } from "@better-auth/core/context";
import { ATTR_CONTEXT, ATTR_DB_COLLECTION_NAME, ATTR_HOOK_TYPE, withSpan } from "@better-auth/core/instrumentation";
//#region src/db/with-hooks.ts
function getWithHooks(adapter, ctx) {
	const hooksEntries = ctx.hooks;
	async function createWithHooks(data, model, customCreateFn) {
		const context = await getCurrentAuthContext().catch(() => null);
		let actualData = data;
		for (const { source, hooks } of hooksEntries) {
			const toRun = hooks[model]?.create?.before;
			if (toRun) {
				const result = await withSpan(`db create.before ${model}`, {
					[ATTR_HOOK_TYPE]: "create.before",
					[ATTR_DB_COLLECTION_NAME]: model,
					[ATTR_CONTEXT]: source
				}, () => toRun(actualData, context));
				if (result === false) return null;
				if (typeof result === "object" && "data" in result) actualData = {
					...actualData,
					...result.data
				};
			}
		}
		let created = null;
		if (!customCreateFn || customCreateFn.executeMainFn) created = await (await getCurrentAdapter(adapter)).create({
			model,
			data: actualData,
			forceAllowId: true
		});
		if (customCreateFn?.fn) created = await customCreateFn.fn(created ?? actualData);
		for (const { source, hooks } of hooksEntries) {
			const toRun = hooks[model]?.create?.after;
			if (toRun) await queueAfterTransactionHook(async () => {
				await withSpan(`db create.after ${model}`, {
					[ATTR_HOOK_TYPE]: "create.after",
					[ATTR_DB_COLLECTION_NAME]: model,
					[ATTR_CONTEXT]: source
				}, () => toRun(created, context));
			});
		}
		return created;
	}
	async function updateWithHooks(data, where, model, customUpdateFn) {
		const context = await getCurrentAuthContext().catch(() => null);
		let actualData = data;
		for (const { source, hooks } of hooksEntries) {
			const toRun = hooks[model]?.update?.before;
			if (toRun) {
				const result = await withSpan(`db update.before ${model}`, {
					[ATTR_HOOK_TYPE]: "update.before",
					[ATTR_DB_COLLECTION_NAME]: model,
					[ATTR_CONTEXT]: source
				}, () => toRun(data, context));
				if (result === false) return null;
				if (typeof result === "object" && "data" in result) actualData = {
					...actualData,
					...result.data
				};
			}
		}
		const customUpdated = customUpdateFn ? await customUpdateFn.fn(actualData) : null;
		const updated = !customUpdateFn || customUpdateFn.executeMainFn ? await (await getCurrentAdapter(adapter)).update({
			model,
			update: actualData,
			where
		}) : customUpdated;
		for (const { source, hooks } of hooksEntries) {
			const toRun = hooks[model]?.update?.after;
			if (toRun) await queueAfterTransactionHook(async () => {
				await withSpan(`db update.after ${model}`, {
					[ATTR_HOOK_TYPE]: "update.after",
					[ATTR_DB_COLLECTION_NAME]: model,
					[ATTR_CONTEXT]: source
				}, () => toRun(updated, context));
			});
		}
		return updated;
	}
	async function updateManyWithHooks(data, where, model, customUpdateFn) {
		const context = await getCurrentAuthContext().catch(() => null);
		let actualData = data;
		for (const { source, hooks } of hooksEntries) {
			const toRun = hooks[model]?.update?.before;
			if (toRun) {
				const result = await withSpan(`db updateMany.before ${model}`, {
					[ATTR_HOOK_TYPE]: "updateMany.before",
					[ATTR_DB_COLLECTION_NAME]: model,
					[ATTR_CONTEXT]: source
				}, () => toRun(data, context));
				if (result === false) return null;
				if (typeof result === "object" && "data" in result) actualData = {
					...actualData,
					...result.data
				};
			}
		}
		const customUpdated = customUpdateFn ? await customUpdateFn.fn(actualData) : null;
		const updated = !customUpdateFn || customUpdateFn.executeMainFn ? await (await getCurrentAdapter(adapter)).updateMany({
			model,
			update: actualData,
			where
		}) : customUpdated;
		for (const { source, hooks } of hooksEntries) {
			const toRun = hooks[model]?.update?.after;
			if (toRun) await queueAfterTransactionHook(async () => {
				await withSpan(`db updateMany.after ${model}`, {
					[ATTR_HOOK_TYPE]: "updateMany.after",
					[ATTR_DB_COLLECTION_NAME]: model,
					[ATTR_CONTEXT]: source
				}, () => toRun(updated, context));
			});
		}
		return updated;
	}
	async function deleteWithHooks(where, model, customDeleteFn) {
		const context = await getCurrentAuthContext().catch(() => null);
		let entityToDelete = null;
		try {
			entityToDelete = (await (await getCurrentAdapter(adapter)).findMany({
				model,
				where,
				limit: 1
			}))[0] || null;
		} catch {}
		if (entityToDelete) for (const { source, hooks } of hooksEntries) {
			const toRun = hooks[model]?.delete?.before;
			if (toRun) {
				if (await withSpan(`db delete.before ${model}`, {
					[ATTR_HOOK_TYPE]: "delete.before",
					[ATTR_DB_COLLECTION_NAME]: model,
					[ATTR_CONTEXT]: source
				}, () => toRun(entityToDelete, context)) === false) return null;
			}
		}
		const customDeleted = customDeleteFn ? await customDeleteFn.fn(where) : null;
		const deleted = (!customDeleteFn || customDeleteFn.executeMainFn) && entityToDelete ? await (await getCurrentAdapter(adapter)).delete({
			model,
			where
		}) : customDeleted;
		if (entityToDelete) for (const { source, hooks } of hooksEntries) {
			const toRun = hooks[model]?.delete?.after;
			if (toRun) await queueAfterTransactionHook(async () => {
				await withSpan(`db delete.after ${model}`, {
					[ATTR_HOOK_TYPE]: "delete.after",
					[ATTR_DB_COLLECTION_NAME]: model,
					[ATTR_CONTEXT]: source
				}, () => toRun(entityToDelete, context));
			});
		}
		return deleted;
	}
	async function deleteManyWithHooks(where, model, customDeleteFn) {
		const context = await getCurrentAuthContext().catch(() => null);
		let entitiesToDelete = [];
		try {
			entitiesToDelete = await (await getCurrentAdapter(adapter)).findMany({
				model,
				where
			});
		} catch {}
		for (const entity of entitiesToDelete) for (const { source, hooks } of hooksEntries) {
			const toRun = hooks[model]?.delete?.before;
			if (toRun) {
				if (await withSpan(`db delete.before ${model}`, {
					[ATTR_HOOK_TYPE]: "delete.before",
					[ATTR_DB_COLLECTION_NAME]: model,
					[ATTR_CONTEXT]: source
				}, () => toRun(entity, context)) === false) return null;
			}
		}
		const customDeleted = customDeleteFn ? await customDeleteFn.fn(where) : null;
		const deleted = !customDeleteFn || customDeleteFn.executeMainFn ? await (await getCurrentAdapter(adapter)).deleteMany({
			model,
			where
		}) : customDeleted;
		for (const entity of entitiesToDelete) for (const { source, hooks } of hooksEntries) {
			const toRun = hooks[model]?.delete?.after;
			if (toRun) await queueAfterTransactionHook(async () => {
				await withSpan(`db delete.after ${model}`, {
					[ATTR_HOOK_TYPE]: "delete.after",
					[ATTR_DB_COLLECTION_NAME]: model,
					[ATTR_CONTEXT]: source
				}, () => toRun(entity, context));
			});
		}
		return deleted;
	}
	return {
		createWithHooks,
		updateWithHooks,
		updateManyWithHooks,
		deleteWithHooks,
		deleteManyWithHooks
	};
}
//#endregion
export { getWithHooks };

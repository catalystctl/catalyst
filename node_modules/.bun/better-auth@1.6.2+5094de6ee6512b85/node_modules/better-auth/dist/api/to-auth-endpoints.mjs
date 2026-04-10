import { isAPIError } from "../utils/is-api-error.mjs";
import { hasRequestState, runWithEndpointContext, runWithRequestState } from "@better-auth/core/context";
import { shouldPublishLog } from "@better-auth/core/env";
import { APIError } from "@better-auth/core/error";
import { createDefu } from "defu";
import { ATTR_CONTEXT, ATTR_HOOK_TYPE, ATTR_HTTP_ROUTE, ATTR_OPERATION_ID, withSpan } from "@better-auth/core/instrumentation";
import { kAPIErrorHeaderSymbol, toResponse } from "better-call";
//#region src/api/to-auth-endpoints.ts
const defuReplaceArrays = createDefu((obj, key, value) => {
	if (Array.isArray(obj[key]) && Array.isArray(value)) {
		obj[key] = value;
		return true;
	}
});
const hooksSourceWeakMap = /* @__PURE__ */ new WeakMap();
function getOperationId(endpoint, key) {
	if (!endpoint?.options) return key;
	const opts = endpoint.options;
	return opts.operationId ?? opts.metadata?.openapi?.operationId ?? key;
}
function toAuthEndpoints(endpoints, ctx) {
	const api = {};
	for (const [key, endpoint] of Object.entries(endpoints)) {
		api[key] = async (context) => {
			const operationId = getOperationId(endpoint, key);
			const endpointMethod = endpoint?.options?.method;
			const defaultMethod = Array.isArray(endpointMethod) ? endpointMethod[0] : endpointMethod;
			const run = async () => {
				const authContext = await ctx;
				const methodName = context?.method ?? context?.request?.method ?? defaultMethod ?? "?";
				const route = endpoint.path ?? "/:virtual";
				let internalContext = {
					...context,
					context: {
						...authContext,
						returned: void 0,
						responseHeaders: void 0,
						session: null
					},
					path: endpoint.path,
					headers: context?.headers ? new Headers(context?.headers) : void 0
				};
				const hasRequest = context?.request instanceof Request;
				const shouldReturnResponse = context?.asResponse ?? hasRequest;
				return withSpan(`${methodName} ${route}`, {
					[ATTR_HTTP_ROUTE]: route,
					[ATTR_OPERATION_ID]: operationId
				}, async () => runWithEndpointContext(internalContext, async () => {
					const { beforeHooks, afterHooks } = getHooks(authContext);
					const before = await runBeforeHooks(internalContext, beforeHooks, endpoint, operationId);
					/**
					* If `before.context` is returned, it should
					* get merged with the original context
					*/
					if ("context" in before && before.context && typeof before.context === "object") {
						const { headers, ...rest } = before.context;
						/**
						* Headers should be merged differently
						* so the hook doesn't override the whole
						* header
						*/
						if (headers) headers.forEach((value, key) => {
							internalContext.headers.set(key, value);
						});
						internalContext = defuReplaceArrays(rest, internalContext);
					} else if (before) return shouldReturnResponse ? toResponse(before, { headers: context?.headers }) : context?.returnHeaders ? {
						headers: context?.headers,
						response: before
					} : before;
					internalContext.asResponse = false;
					internalContext.returnHeaders = true;
					internalContext.returnStatus = true;
					const result = await runWithEndpointContext(internalContext, () => withSpan(`handler ${route}`, {
						[ATTR_HTTP_ROUTE]: route,
						[ATTR_OPERATION_ID]: operationId
					}, () => endpoint(internalContext))).catch((e) => {
						if (isAPIError(e))
 /**
						* API Errors from response are caught
						* and returned to hooks
						*/
						return {
							response: e,
							status: e.statusCode,
							headers: e.headers ? new Headers(e.headers) : null
						};
						throw e;
					});
					if (result && result instanceof Response) return result;
					internalContext.context.returned = result.response;
					internalContext.context.responseHeaders = result.headers;
					const after = await runAfterHooks(internalContext, afterHooks, endpoint, operationId);
					if (after.response) result.response = after.response;
					if (isAPIError(result.response) && shouldPublishLog(authContext.logger.level, "debug")) result.response.stack = result.response.errorStack;
					if (isAPIError(result.response) && !shouldReturnResponse) throw result.response;
					return shouldReturnResponse ? toResponse(result.response, {
						headers: result.headers,
						status: result.status
					}) : context?.returnHeaders ? context?.returnStatus ? {
						headers: result.headers,
						response: result.response,
						status: result.status
					} : {
						headers: result.headers,
						response: result.response
					} : context?.returnStatus ? {
						response: result.response,
						status: result.status
					} : result.response;
				}));
			};
			if (await hasRequestState()) return run();
			else return runWithRequestState(/* @__PURE__ */ new WeakMap(), run);
		};
		api[key].path = endpoint.path;
		api[key].options = endpoint.options;
	}
	return api;
}
async function runBeforeHooks(context, hooks, endpoint, operationId) {
	let modifiedContext = {};
	for (const hook of hooks) {
		let matched = false;
		try {
			matched = hook.matcher(context);
		} catch (error) {
			const hookSource = hooksSourceWeakMap.get(hook.handler) ?? "unknown";
			context.context.logger.error(`An error occurred during ${hookSource} hook matcher execution:`, error);
			throw new APIError("INTERNAL_SERVER_ERROR", { message: `An error occurred during hook matcher execution. Check the logs for more details.` });
		}
		if (matched) {
			const hookSource = hooksSourceWeakMap.get(hook.handler) ?? "unknown";
			const route = endpoint.path ?? "/:virtual";
			const result = await withSpan(`hook before ${route} ${hookSource}`, {
				[ATTR_HOOK_TYPE]: "before",
				[ATTR_HTTP_ROUTE]: route,
				[ATTR_CONTEXT]: hookSource,
				[ATTR_OPERATION_ID]: operationId
			}, () => hook.handler({
				...context,
				returnHeaders: false
			})).catch((e) => {
				if (isAPIError(e) && shouldPublishLog(context.context.logger.level, "debug")) e.stack = e.errorStack;
				throw e;
			});
			if (result && typeof result === "object") {
				if ("context" in result && typeof result.context === "object") {
					const { headers, ...rest } = result.context;
					if (headers instanceof Headers) if (modifiedContext.headers) headers.forEach((value, key) => {
						modifiedContext.headers?.set(key, value);
					});
					else modifiedContext.headers = headers;
					modifiedContext = defuReplaceArrays(rest, modifiedContext);
					continue;
				}
				return result;
			}
		}
	}
	return { context: modifiedContext };
}
async function runAfterHooks(context, hooks, endpoint, operationId) {
	for (const hook of hooks) if (hook.matcher(context)) {
		const hookSource = hooksSourceWeakMap.get(hook.handler) ?? "unknown";
		const route = endpoint.path ?? "/:virtual";
		const result = await withSpan(`hook after ${route} ${hookSource}`, {
			[ATTR_HOOK_TYPE]: "after",
			[ATTR_HTTP_ROUTE]: route,
			[ATTR_CONTEXT]: hookSource,
			[ATTR_OPERATION_ID]: operationId
		}, () => hook.handler(context)).catch((e) => {
			if (isAPIError(e)) {
				const headers = e[kAPIErrorHeaderSymbol];
				if (shouldPublishLog(context.context.logger.level, "debug")) e.stack = e.errorStack;
				return {
					response: e,
					headers: headers ? headers : e.headers ? new Headers(e.headers) : null
				};
			}
			throw e;
		});
		if (result.headers) result.headers.forEach((value, key) => {
			if (!context.context.responseHeaders) context.context.responseHeaders = new Headers({ [key]: value });
			else if (key.toLowerCase() === "set-cookie") context.context.responseHeaders.append(key, value);
			else context.context.responseHeaders.set(key, value);
		});
		if (result.response) context.context.returned = result.response;
	}
	return {
		response: context.context.returned,
		headers: context.context.responseHeaders
	};
}
function getHooks(authContext) {
	const plugins = authContext.options.plugins || [];
	const beforeHooks = [];
	const afterHooks = [];
	const beforeHookHandler = authContext.options.hooks?.before;
	if (beforeHookHandler) {
		hooksSourceWeakMap.set(beforeHookHandler, "user");
		beforeHooks.push({
			matcher: () => true,
			handler: beforeHookHandler
		});
	}
	const afterHookHandler = authContext.options.hooks?.after;
	if (afterHookHandler) {
		hooksSourceWeakMap.set(afterHookHandler, "user");
		afterHooks.push({
			matcher: () => true,
			handler: afterHookHandler
		});
	}
	const pluginBeforeHooks = plugins.flatMap((plugin) => (plugin.hooks?.before ?? []).map((h) => {
		hooksSourceWeakMap.set(h.handler, `plugin:${plugin.id}`);
		return h;
	}));
	const pluginAfterHooks = plugins.flatMap((plugin) => (plugin.hooks?.after ?? []).map((h) => {
		hooksSourceWeakMap.set(h.handler, `plugin:${plugin.id}`);
		return h;
	}));
	/**
	* Add plugin added hooks at last
	*/
	if (pluginBeforeHooks.length) beforeHooks.push(...pluginBeforeHooks);
	if (pluginAfterHooks.length) afterHooks.push(...pluginAfterHooks);
	return {
		beforeHooks,
		afterHooks
	};
}
//#endregion
export { toAuthEndpoints };

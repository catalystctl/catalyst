import { kAPIErrorHeaderSymbol } from "./error.mjs";
import { isAPIError } from "./utils.mjs";
import { createInternalContext } from "./context.mjs";
import "./endpoint.mjs";

//#region src/middleware.ts
function createMiddleware(optionsOrHandler, handler) {
	const internalHandler = async (inputCtx) => {
		const context = inputCtx;
		const _handler = typeof optionsOrHandler === "function" ? optionsOrHandler : handler;
		const internalContext = await createInternalContext(context, {
			options: typeof optionsOrHandler === "function" ? {} : optionsOrHandler,
			path: "/"
		});
		if (!_handler) throw new Error("handler must be defined");
		try {
			const response = await _handler(internalContext);
			const headers = internalContext.responseHeaders;
			return context.returnHeaders ? {
				headers,
				response
			} : response;
		} catch (e) {
			if (isAPIError(e)) Object.defineProperty(e, kAPIErrorHeaderSymbol, {
				enumerable: false,
				configurable: true,
				get() {
					return internalContext.responseHeaders;
				}
			});
			throw e;
		}
	};
	internalHandler.options = typeof optionsOrHandler === "function" ? {} : optionsOrHandler;
	return internalHandler;
}
createMiddleware.create = (opts) => {
	function fn(optionsOrHandler, handler) {
		if (typeof optionsOrHandler === "function") return createMiddleware({ use: opts?.use }, optionsOrHandler);
		if (!handler) throw new Error("Middleware handler is required");
		return createMiddleware({
			...optionsOrHandler,
			method: "*",
			use: [...opts?.use || [], ...optionsOrHandler.use || []]
		}, handler);
	}
	return fn;
};

//#endregion
export { createMiddleware };
//# sourceMappingURL=middleware.mjs.map
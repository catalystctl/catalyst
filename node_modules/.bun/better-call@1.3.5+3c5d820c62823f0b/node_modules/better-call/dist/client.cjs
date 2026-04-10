Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
const require_runtime = require('./_virtual/_rolldown/runtime.cjs');
const require_error = require('./error.cjs');
let _better_fetch_fetch = require("@better-fetch/fetch");

//#region src/client.ts
const createClient = (options) => {
	const fetch = (0, _better_fetch_fetch.createFetch)(options ?? {});
	return async (path, ...options) => {
		return await fetch(path, { ...options[0] });
	};
};

//#endregion
exports.APIError = require_error.APIError;
exports.BetterCallError = require_error.BetterCallError;
exports.ValidationError = require_error.ValidationError;
exports.createClient = createClient;
exports.hideInternalStackFrames = require_error.hideInternalStackFrames;
exports.kAPIErrorHeaderSymbol = require_error.kAPIErrorHeaderSymbol;
exports.makeErrorForHideStackFrame = require_error.makeErrorForHideStackFrame;
exports.statusCodes = require_error.statusCodes;
//# sourceMappingURL=client.cjs.map
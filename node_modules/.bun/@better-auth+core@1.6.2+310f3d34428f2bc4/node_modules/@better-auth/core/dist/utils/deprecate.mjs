//#region src/utils/deprecate.ts
/**
* Wraps a function to log a deprecation warning at once.
*/
function deprecate(fn, message, logger) {
	let warned = false;
	return function(...args) {
		if (!warned) {
			(logger?.warn ?? console.warn)(`[Deprecation] ${message}`);
			warned = true;
		}
		return fn.apply(this, args);
	};
}
//#endregion
export { deprecate };

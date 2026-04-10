//#region src/context/global.ts
const symbol = Symbol.for("better-auth:global");
let bind = null;
const __context = {};
const __betterAuthVersion = "1.6.2";
/**
* We store context instance in the globalThis.
*
* The reason we do this is that some bundlers, web framework, or package managers might
* create multiple copies of BetterAuth in the same process intentionally or unintentionally.
*
* For example, yarn v1, Next.js, SSR, Vite...
*
* @internal
*/
function __getBetterAuthGlobal() {
	if (!globalThis[symbol]) {
		globalThis[symbol] = {
			version: __betterAuthVersion,
			epoch: 1,
			context: __context
		};
		bind = globalThis[symbol];
	}
	bind = globalThis[symbol];
	if (bind.version !== __betterAuthVersion) {
		bind.version = __betterAuthVersion;
		bind.epoch++;
	}
	return globalThis[symbol];
}
function getBetterAuthVersion() {
	return __getBetterAuthGlobal().version;
}
//#endregion
export { __getBetterAuthGlobal, getBetterAuthVersion };

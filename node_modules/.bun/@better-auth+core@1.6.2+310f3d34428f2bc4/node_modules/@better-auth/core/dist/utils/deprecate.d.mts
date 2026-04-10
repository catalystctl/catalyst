import { InternalLogger } from "../env/logger.mjs";

//#region src/utils/deprecate.d.ts
/**
 * Wraps a function to log a deprecation warning at once.
 */
declare function deprecate<T extends (...args: any[]) => any>(fn: T, message: string, logger?: InternalLogger): T;
//#endregion
export { deprecate };
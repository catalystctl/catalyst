//#region src/client/parser.d.ts
type ParseOptions = {
  /** Throw errors instead of returning the original value */strict?: boolean | undefined; /** Log warnings when suspicious patterns are detected */
  warnings?: boolean | undefined; /** Custom reviver function */
  reviver?: ((key: string, value: any) => any) | undefined; /** Automatically convert ISO date strings to Date objects */
  parseDates?: boolean | undefined;
};
declare function parseJSON<T = unknown>(value: unknown, options?: ParseOptions): T;
//#endregion
export { parseJSON };
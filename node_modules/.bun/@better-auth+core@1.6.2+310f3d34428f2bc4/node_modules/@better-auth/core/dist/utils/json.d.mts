//#region src/utils/json.d.ts
declare function safeJSONParse<T>(data: unknown): T | null;
//#endregion
export { safeJSONParse };
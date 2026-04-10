import { DBFieldAttribute } from "../type.mjs";

//#region src/db/adapter/utils.d.ts
declare function withApplyDefault(value: any, field: DBFieldAttribute, action: "create" | "update" | "findOne" | "findMany"): any;
declare function deepmerge<T>(target: T, source: Partial<T>): T;
//#endregion
export { deepmerge, withApplyDefault };
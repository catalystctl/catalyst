import { BetterAuthDBSchema } from "../type.mjs";

//#region src/db/adapter/get-field-name.d.ts
declare const initGetFieldName: ({
  schema,
  usePlural
}: {
  schema: BetterAuthDBSchema;
  usePlural: boolean | undefined;
}) => ({
  model: modelName,
  field: fieldName
}: {
  model: string;
  field: string;
}) => string;
//#endregion
export { initGetFieldName };
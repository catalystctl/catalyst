import { BetterAuthDBSchema } from "../type.mjs";

//#region src/db/adapter/get-default-field-name.d.ts
declare const initGetDefaultFieldName: ({
  schema,
  usePlural
}: {
  schema: BetterAuthDBSchema;
  usePlural: boolean | undefined;
}) => ({
  field,
  model: unsafeModel
}: {
  model: string;
  field: string;
}) => string;
//#endregion
export { initGetDefaultFieldName };
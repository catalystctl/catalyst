import { BetterAuthDBSchema } from "../type.mjs";

//#region src/db/adapter/get-model-name.d.ts
declare const initGetModelName: ({
  usePlural,
  schema
}: {
  usePlural: boolean | undefined;
  schema: BetterAuthDBSchema;
}) => (model: string) => string;
//#endregion
export { initGetModelName };
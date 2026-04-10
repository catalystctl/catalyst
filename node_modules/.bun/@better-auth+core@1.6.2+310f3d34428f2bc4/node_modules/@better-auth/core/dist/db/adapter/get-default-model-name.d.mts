import { BetterAuthDBSchema } from "../type.mjs";

//#region src/db/adapter/get-default-model-name.d.ts
declare const initGetDefaultModelName: ({
  usePlural,
  schema
}: {
  usePlural: boolean | undefined;
  schema: BetterAuthDBSchema;
}) => (model: string) => string;
//#endregion
export { initGetDefaultModelName };
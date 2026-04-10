import { BetterAuthDBSchema, DBFieldAttribute, DBFieldType } from "../type.mjs";
import { BetterAuthOptions } from "../../types/init-options.mjs";
//#region src/db/adapter/get-field-attributes.d.ts
declare const initGetFieldAttributes: ({
  usePlural,
  schema,
  options,
  customIdGenerator,
  disableIdGeneration
}: {
  usePlural?: boolean;
  schema: BetterAuthDBSchema;
  options: BetterAuthOptions;
  disableIdGeneration?: boolean;
  customIdGenerator?: ((props: {
    model: string;
  }) => string) | undefined;
}) => ({
  model,
  field
}: {
  model: string;
  field: string;
}) => DBFieldAttribute<DBFieldType>;
//#endregion
export { initGetFieldAttributes };
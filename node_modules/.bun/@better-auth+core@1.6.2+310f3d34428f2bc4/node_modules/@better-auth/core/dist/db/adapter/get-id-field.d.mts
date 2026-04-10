import { BetterAuthDBSchema, DBPrimitive } from "../type.mjs";
import { BetterAuthOptions } from "../../types/init-options.mjs";
//#region src/db/adapter/get-id-field.d.ts
declare const initGetIdField: ({
  usePlural,
  schema,
  disableIdGeneration,
  options,
  customIdGenerator,
  supportsUUIDs
}: {
  usePlural?: boolean;
  schema: BetterAuthDBSchema;
  options: BetterAuthOptions;
  disableIdGeneration?: boolean;
  customIdGenerator?: ((props: {
    model: string;
  }) => string) | undefined;
  supportsUUIDs?: boolean;
}) => ({
  customModelName,
  forceAllowId
}: {
  customModelName?: string;
  forceAllowId?: boolean;
}) => {
  transform: {
    input: (value: DBPrimitive) => string | number | true | unknown[] | Date | Record<string, unknown> | undefined;
    output: (value: DBPrimitive) => string | undefined;
  };
  defaultValue?: (() => string | false | undefined) | undefined;
  type: "string" | "number";
  required: boolean;
};
//#endregion
export { initGetIdField };
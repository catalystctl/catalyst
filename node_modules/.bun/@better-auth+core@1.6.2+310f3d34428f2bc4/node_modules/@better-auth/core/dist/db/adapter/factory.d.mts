import { initGetDefaultFieldName } from "./get-default-field-name.mjs";
import { initGetDefaultModelName } from "./get-default-model-name.mjs";
import { initGetFieldAttributes } from "./get-field-attributes.mjs";
import { initGetFieldName } from "./get-field-name.mjs";
import { initGetIdField } from "./get-id-field.mjs";
import { initGetModelName } from "./get-model-name.mjs";
import { AdapterFactoryConfig, AdapterFactoryCustomizeAdapterCreator, AdapterFactoryOptions, AdapterTestDebugLogs } from "./types.mjs";
import { DBAdapter } from "./index.mjs";
import { BetterAuthOptions } from "../../types/init-options.mjs";
//#region src/db/adapter/factory.d.ts
type AdapterFactory<Options extends BetterAuthOptions> = (options: Options) => DBAdapter<Options>;
declare const createAdapterFactory: <Options extends BetterAuthOptions>({
  adapter: customAdapter,
  config: cfg
}: AdapterFactoryOptions) => AdapterFactory<Options>;
//#endregion
export { AdapterFactory, createAdapterFactory };
import * as _better_auth_core0 from "@better-auth/core";
import { AdapterFactory, AdapterFactoryConfig, AdapterFactoryCustomizeAdapterCreator, AdapterFactoryOptions, AdapterTestDebugLogs, CustomAdapter, createAdapterFactory, initGetDefaultFieldName, initGetDefaultModelName, initGetFieldAttributes, initGetFieldName, initGetIdField, initGetModelName } from "@better-auth/core/db/adapter";
export * from "@better-auth/core/db/adapter";

//#region src/adapters/index.d.ts
/**
 * @deprecated Use `createAdapterFactory` instead.
 */
declare const createAdapter: <Options extends _better_auth_core0.BetterAuthOptions>({
  adapter: customAdapter,
  config: cfg
}: AdapterFactoryOptions) => AdapterFactory<Options>;
/**
 * @deprecated Use `AdapterFactoryOptions` instead.
 */
type CreateAdapterOptions = AdapterFactoryOptions;
/**
 * @deprecated Use `AdapterFactoryConfig` instead.
 */
type AdapterConfig = AdapterFactoryConfig;
/**
 * @deprecated Use `AdapterFactoryCustomizeAdapterCreator` instead.
 */
type CreateCustomAdapter = AdapterFactoryCustomizeAdapterCreator;
//#endregion
export { AdapterConfig, type AdapterFactory, type AdapterFactoryConfig, type AdapterFactoryCustomizeAdapterCreator, type AdapterFactoryOptions, type AdapterTestDebugLogs, CreateAdapterOptions, CreateCustomAdapter, type CustomAdapter, createAdapter, createAdapterFactory, initGetDefaultFieldName, initGetDefaultModelName, initGetFieldAttributes, initGetFieldName, initGetIdField, initGetModelName };
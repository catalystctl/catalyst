//#region src/env/env-impl.d.ts
type EnvObject = Record<string, string | undefined>;
declare const env: EnvObject;
declare const nodeENV: string;
/** Detect if `NODE_ENV` environment variable is `production` */
declare const isProduction: boolean;
/** Detect if `NODE_ENV` environment variable is `dev` or `development` */
declare const isDevelopment: () => boolean;
/** Detect if `NODE_ENV` environment variable is `test` */
declare const isTest: () => boolean;
/**
 * Get environment variable with fallback
 */
declare function getEnvVar<Fallback extends string>(key: string, fallback?: Fallback): Fallback extends string ? string : string | undefined;
/**
 * Get boolean environment variable
 */
declare function getBooleanEnvVar(key: string, fallback?: boolean): boolean;
/**
 * Common environment variables used in Better Auth
 */
declare const ENV: Readonly<{
  readonly BETTER_AUTH_SECRET: string;
  readonly AUTH_SECRET: string;
  readonly BETTER_AUTH_TELEMETRY: string;
  readonly BETTER_AUTH_TELEMETRY_ID: string;
  readonly NODE_ENV: string;
  readonly PACKAGE_VERSION: string;
  readonly BETTER_AUTH_TELEMETRY_ENDPOINT: string | undefined;
}>;
//#endregion
export { ENV, EnvObject, env, getBooleanEnvVar, getEnvVar, isDevelopment, isProduction, isTest, nodeENV };
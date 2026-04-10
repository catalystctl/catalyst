//#region src/types/secret.d.ts
interface SecretConfig {
  /** Map of version number → secret value */
  keys: Map<number, string>;
  /** Version to use for new encryption (first entry in secrets array) */
  currentVersion: number;
  /** Legacy secret for bare-hex fallback (from BETTER_AUTH_SECRET) */
  legacySecret?: string;
}
//#endregion
export { SecretConfig };
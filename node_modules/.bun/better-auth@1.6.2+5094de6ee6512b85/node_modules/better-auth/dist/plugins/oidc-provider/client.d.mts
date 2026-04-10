import { AuthorizationQuery, Client, CodeVerificationValue, OAuthAccessToken, OIDCMetadata, OIDCOptions, TokenBody } from "./types.mjs";
import { oidcProvider } from "./index.mjs";

//#region src/plugins/oidc-provider/client.d.ts
/**
 * @deprecated Use `@better-auth/oauth-provider` instead. This plugin will be removed in the next major version.
 * @see https://www.better-auth.com/docs/plugins/oauth-provider
 */
declare const oidcClient: () => {
  id: "oidc-client";
  version: string;
  $InferServerPlugin: ReturnType<typeof oidcProvider>;
};
type OidcClientPlugin = ReturnType<typeof oidcClient>;
//#endregion
export { OidcClientPlugin, oidcClient };
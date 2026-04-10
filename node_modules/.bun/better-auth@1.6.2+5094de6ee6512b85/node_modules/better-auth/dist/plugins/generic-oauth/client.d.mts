import { GenericOAuthConfig, GenericOAuthOptions } from "./types.mjs";
import { Auth0Options, auth0 } from "./providers/auth0.mjs";
import { GumroadOptions, gumroad } from "./providers/gumroad.mjs";
import { HubSpotOptions, hubspot } from "./providers/hubspot.mjs";
import { KeycloakOptions, keycloak } from "./providers/keycloak.mjs";
import { LineOptions, line } from "./providers/line.mjs";
import { MicrosoftEntraIdOptions, microsoftEntraId } from "./providers/microsoft-entra-id.mjs";
import { OktaOptions, okta } from "./providers/okta.mjs";
import { PatreonOptions, patreon } from "./providers/patreon.mjs";
import { SlackOptions, slack } from "./providers/slack.mjs";
import { BaseOAuthProviderOptions, genericOAuth } from "./index.mjs";
import { GENERIC_OAUTH_ERROR_CODES } from "./error-codes.mjs";
import * as _better_auth_core_utils_error_codes0 from "@better-auth/core/utils/error-codes";

//#region src/plugins/generic-oauth/client.d.ts
declare const genericOAuthClient: () => {
  id: "generic-oauth-client";
  version: string;
  $InferServerPlugin: ReturnType<typeof genericOAuth>;
  $ERROR_CODES: {
    INVALID_OAUTH_CONFIGURATION: _better_auth_core_utils_error_codes0.RawError<"INVALID_OAUTH_CONFIGURATION">;
    TOKEN_URL_NOT_FOUND: _better_auth_core_utils_error_codes0.RawError<"TOKEN_URL_NOT_FOUND">;
    PROVIDER_CONFIG_NOT_FOUND: _better_auth_core_utils_error_codes0.RawError<"PROVIDER_CONFIG_NOT_FOUND">;
    PROVIDER_ID_REQUIRED: _better_auth_core_utils_error_codes0.RawError<"PROVIDER_ID_REQUIRED">;
    INVALID_OAUTH_CONFIG: _better_auth_core_utils_error_codes0.RawError<"INVALID_OAUTH_CONFIG">;
    SESSION_REQUIRED: _better_auth_core_utils_error_codes0.RawError<"SESSION_REQUIRED">;
    ISSUER_MISMATCH: _better_auth_core_utils_error_codes0.RawError<"ISSUER_MISMATCH">;
    ISSUER_MISSING: _better_auth_core_utils_error_codes0.RawError<"ISSUER_MISSING">;
  };
};
//#endregion
export { genericOAuthClient };
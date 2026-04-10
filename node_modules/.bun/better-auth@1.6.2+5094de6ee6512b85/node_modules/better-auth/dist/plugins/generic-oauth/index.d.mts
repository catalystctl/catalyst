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
import { AuthContext } from "@better-auth/core";
import * as _better_auth_core_oauth20 from "@better-auth/core/oauth2";
import { OAuthProvider } from "@better-auth/core/oauth2";
import * as _better_auth_core_utils_error_codes0 from "@better-auth/core/utils/error-codes";
import * as better_call0 from "better-call";
import * as zod from "zod";
import * as zod_v4_core0 from "zod/v4/core";

//#region src/plugins/generic-oauth/index.d.ts
declare module "@better-auth/core" {
  interface BetterAuthPluginRegistry<AuthOptions, Options> {
    "generic-oauth": {
      creator: typeof genericOAuth;
    };
  }
}
/**
 * Base type for OAuth provider options.
 * Extracts common fields from GenericOAuthConfig and makes clientSecret required.
 */
type BaseOAuthProviderOptions = Omit<Pick<GenericOAuthConfig, "clientId" | "clientSecret" | "scopes" | "redirectURI" | "pkce" | "disableImplicitSignUp" | "disableSignUp" | "overrideUserInfo">, "clientSecret"> & {
  /** OAuth client secret (required for provider options) */clientSecret: string;
};
/**
 * A generic OAuth plugin that can be used to add OAuth support to any provider
 */
declare const genericOAuth: (options: GenericOAuthOptions) => {
  id: "generic-oauth";
  version: string;
  init: (ctx: AuthContext) => {
    context: {
      socialProviders: OAuthProvider<Record<string, any>, Partial<_better_auth_core_oauth20.ProviderOptions<any>>>[];
    };
  };
  endpoints: {
    signInWithOAuth2: better_call0.StrictEndpoint<"/sign-in/oauth2", {
      method: "POST";
      body: zod.ZodObject<{
        providerId: zod.ZodString;
        callbackURL: zod.ZodOptional<zod.ZodString>;
        errorCallbackURL: zod.ZodOptional<zod.ZodString>;
        newUserCallbackURL: zod.ZodOptional<zod.ZodString>;
        disableRedirect: zod.ZodOptional<zod.ZodBoolean>;
        scopes: zod.ZodOptional<zod.ZodArray<zod.ZodString>>;
        requestSignUp: zod.ZodOptional<zod.ZodBoolean>;
        additionalData: zod.ZodOptional<zod.ZodRecord<zod.ZodString, zod.ZodAny>>;
      }, zod_v4_core0.$strip>;
      metadata: {
        openapi: {
          description: string;
          responses: {
            200: {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    properties: {
                      url: {
                        type: string;
                      };
                      redirect: {
                        type: string;
                      };
                    };
                  };
                };
              };
            };
          };
        };
      };
    }, {
      url: string;
      redirect: boolean;
    }>;
    oAuth2Callback: better_call0.StrictEndpoint<"/oauth2/callback/:providerId", {
      method: "GET";
      query: zod.ZodObject<{
        code: zod.ZodOptional<zod.ZodString>;
        error: zod.ZodOptional<zod.ZodString>;
        error_description: zod.ZodOptional<zod.ZodString>;
        state: zod.ZodOptional<zod.ZodString>;
        iss: zod.ZodOptional<zod.ZodString>;
      }, zod_v4_core0.$strip>;
      metadata: {
        allowedMediaTypes: string[];
        openapi: {
          description: string;
          responses: {
            200: {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    properties: {
                      url: {
                        type: string;
                      };
                    };
                  };
                };
              };
            };
          };
        };
        scope: "server";
      };
    }, void>;
    oAuth2LinkAccount: better_call0.StrictEndpoint<"/oauth2/link", {
      method: "POST";
      body: zod.ZodObject<{
        providerId: zod.ZodString;
        callbackURL: zod.ZodString;
        scopes: zod.ZodOptional<zod.ZodArray<zod.ZodString>>;
        errorCallbackURL: zod.ZodOptional<zod.ZodString>;
      }, zod_v4_core0.$strip>;
      use: ((inputContext: better_call0.MiddlewareInputContext<better_call0.MiddlewareOptions>) => Promise<{
        session: {
          session: Record<string, any> & {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            userId: string;
            expiresAt: Date;
            token: string;
            ipAddress?: string | null | undefined;
            userAgent?: string | null | undefined;
          };
          user: Record<string, any> & {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            email: string;
            emailVerified: boolean;
            name: string;
            image?: string | null | undefined;
          };
        };
      }>)[];
      metadata: {
        openapi: {
          description: string;
          responses: {
            "200": {
              description: string;
              content: {
                "application/json": {
                  schema: {
                    type: "object";
                    properties: {
                      url: {
                        type: string;
                        format: string;
                        description: string;
                      };
                      redirect: {
                        type: string;
                        description: string;
                        enum: boolean[];
                      };
                    };
                    required: string[];
                  };
                };
              };
            };
          };
        };
      };
    }, {
      url: string;
      redirect: boolean;
    }>;
  };
  options: GenericOAuthOptions;
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
export { Auth0Options, BaseOAuthProviderOptions, type GenericOAuthConfig, type GenericOAuthOptions, GumroadOptions, HubSpotOptions, KeycloakOptions, LineOptions, MicrosoftEntraIdOptions, OktaOptions, PatreonOptions, SlackOptions, auth0, genericOAuth, gumroad, hubspot, keycloak, line, microsoftEntraId, okta, patreon, slack };
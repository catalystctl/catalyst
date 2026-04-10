import { AwaitableFunction } from "../types/helper.mjs";
import { OAuth2Tokens, ProviderOptions } from "./oauth-provider.mjs";

//#region src/oauth2/client-credentials-token.d.ts
declare function clientCredentialsTokenRequest({
  options,
  scope,
  authentication,
  resource
}: {
  options: AwaitableFunction<ProviderOptions & {
    clientSecret: string;
  }>;
  scope?: string | undefined;
  authentication?: ("basic" | "post") | undefined;
  resource?: (string | string[]) | undefined;
}): Promise<{
  body: URLSearchParams;
  headers: Record<string, any>;
}>;
/**
 * @deprecated use async'd clientCredentialsTokenRequest instead
 */
declare function createClientCredentialsTokenRequest({
  options,
  scope,
  authentication,
  resource
}: {
  options: ProviderOptions & {
    clientSecret: string;
  };
  scope?: string | undefined;
  authentication?: ("basic" | "post") | undefined;
  resource?: (string | string[]) | undefined;
}): {
  body: URLSearchParams;
  headers: Record<string, any>;
};
declare function clientCredentialsToken({
  options,
  tokenEndpoint,
  scope,
  authentication,
  resource
}: {
  options: AwaitableFunction<ProviderOptions & {
    clientSecret: string;
  }>;
  tokenEndpoint: string;
  scope: string;
  authentication?: ("basic" | "post") | undefined;
  resource?: (string | string[]) | undefined;
}): Promise<OAuth2Tokens>;
//#endregion
export { clientCredentialsToken, clientCredentialsTokenRequest, createClientCredentialsTokenRequest };
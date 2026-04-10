import { AwaitableFunction } from "../types/helper.mjs";
import { ProviderOptions } from "./oauth-provider.mjs";
//#region src/oauth2/create-authorization-url.d.ts
declare function createAuthorizationURL({
  id,
  options,
  authorizationEndpoint,
  state,
  codeVerifier,
  scopes,
  claims,
  redirectURI,
  duration,
  prompt,
  accessType,
  responseType,
  display,
  loginHint,
  hd,
  responseMode,
  additionalParams,
  scopeJoiner
}: {
  id: string;
  options: AwaitableFunction<ProviderOptions>;
  redirectURI: string;
  authorizationEndpoint: string;
  state: string;
  codeVerifier?: string | undefined;
  scopes?: string[] | undefined;
  claims?: string[] | undefined;
  duration?: string | undefined;
  prompt?: string | undefined;
  accessType?: string | undefined;
  responseType?: string | undefined;
  display?: string | undefined;
  loginHint?: string | undefined;
  hd?: string | undefined;
  responseMode?: string | undefined;
  additionalParams?: Record<string, string> | undefined;
  scopeJoiner?: string | undefined;
}): Promise<URL>;
//#endregion
export { createAuthorizationURL };
import { OAuth2Tokens, ProviderOptions } from "../oauth2/oauth-provider.mjs";
//#region src/social-providers/atlassian.d.ts
interface AtlassianProfile {
  account_type?: string | undefined;
  account_id: string;
  email?: string | undefined;
  name: string;
  picture?: string | undefined;
  nickname?: string | undefined;
  locale?: string | undefined;
  extended_profile?: {
    job_title?: string;
    organization?: string;
    department?: string;
    location?: string;
  } | undefined;
}
interface AtlassianOptions extends ProviderOptions<AtlassianProfile> {
  clientId: string;
}
declare const atlassian: (options: AtlassianOptions) => {
  id: "atlassian";
  name: string;
  createAuthorizationURL({
    state,
    scopes,
    codeVerifier,
    redirectURI
  }: {
    state: string;
    codeVerifier: string;
    scopes?: string[] | undefined;
    redirectURI: string;
    display?: string | undefined;
    loginHint?: string | undefined;
  }): Promise<URL>;
  validateAuthorizationCode: ({
    code,
    codeVerifier,
    redirectURI
  }: {
    code: string;
    redirectURI: string;
    codeVerifier?: string | undefined;
    deviceId?: string | undefined;
  }) => Promise<OAuth2Tokens>;
  refreshAccessToken: (refreshToken: string) => Promise<OAuth2Tokens>;
  getUserInfo(token: OAuth2Tokens & {
    user?: {
      name?: {
        firstName?: string;
        lastName?: string;
      };
      email?: string;
    } | undefined;
  }): Promise<{
    user: {
      id: string;
      name?: string;
      email?: string | null;
      image?: string;
      emailVerified: boolean;
      [key: string]: any;
    };
    data: any;
  } | null>;
  options: AtlassianOptions;
};
//#endregion
export { AtlassianOptions, AtlassianProfile, atlassian };
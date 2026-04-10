import { OAuth2Tokens, ProviderOptions } from "../oauth2/oauth-provider.mjs";
//#region src/social-providers/linkedin.d.ts
interface LinkedInProfile {
  sub: string;
  name: string;
  given_name: string;
  family_name: string;
  picture: string;
  locale: {
    country: string;
    language: string;
  };
  email: string;
  email_verified: boolean;
}
interface LinkedInOptions extends ProviderOptions<LinkedInProfile> {
  clientId: string;
}
declare const linkedin: (options: LinkedInOptions) => {
  id: "linkedin";
  name: string;
  createAuthorizationURL: ({
    state,
    scopes,
    redirectURI,
    loginHint
  }: {
    state: string;
    codeVerifier: string;
    scopes?: string[] | undefined;
    redirectURI: string;
    display?: string | undefined;
    loginHint?: string | undefined;
  }) => Promise<URL>;
  validateAuthorizationCode: ({
    code,
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
  options: LinkedInOptions;
};
//#endregion
export { LinkedInOptions, LinkedInProfile, linkedin };
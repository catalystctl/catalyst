import { OAuth2Tokens, ProviderOptions } from "../oauth2/oauth-provider.mjs";
//#region src/social-providers/salesforce.d.ts
interface SalesforceProfile {
  sub: string;
  user_id: string;
  organization_id: string;
  preferred_username?: string | undefined;
  email: string;
  email_verified?: boolean | undefined;
  name: string;
  given_name?: string | undefined;
  family_name?: string | undefined;
  zoneinfo?: string | undefined;
  photos?: {
    picture?: string;
    thumbnail?: string;
  } | undefined;
}
interface SalesforceOptions extends ProviderOptions<SalesforceProfile> {
  clientId: string;
  environment?: ("sandbox" | "production") | undefined;
  loginUrl?: string | undefined;
  /**
   * Override the redirect URI if auto-detection fails.
   * Should match the Callback URL configured in your Salesforce Connected App.
   * @example "http://localhost:3000/api/auth/callback/salesforce"
   */
  redirectURI?: string | undefined;
}
declare const salesforce: (options: SalesforceOptions) => {
  id: "salesforce";
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
  options: SalesforceOptions;
};
//#endregion
export { SalesforceOptions, SalesforceProfile, salesforce };
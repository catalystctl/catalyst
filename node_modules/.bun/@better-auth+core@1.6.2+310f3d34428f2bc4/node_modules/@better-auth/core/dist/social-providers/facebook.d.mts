import { OAuth2Tokens, ProviderOptions } from "../oauth2/oauth-provider.mjs";
//#region src/social-providers/facebook.d.ts
interface FacebookProfile {
  id: string;
  name: string;
  email: string;
  email_verified: boolean;
  picture: {
    data: {
      height: number;
      is_silhouette: boolean;
      url: string;
      width: number;
    };
  };
}
interface FacebookOptions extends ProviderOptions<FacebookProfile> {
  clientId: string;
  /**
   * Extend list of fields to retrieve from the Facebook user profile.
   *
   * @default ["id", "name", "email", "picture"]
   */
  fields?: string[] | undefined;
  /**
   * The config id to use when undergoing oauth
   */
  configId?: string | undefined;
}
declare const facebook: (options: FacebookOptions) => {
  id: "facebook";
  name: string;
  createAuthorizationURL({
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
  }): Promise<URL>;
  validateAuthorizationCode: ({
    code,
    redirectURI
  }: {
    code: string;
    redirectURI: string;
    codeVerifier?: string | undefined;
    deviceId?: string | undefined;
  }) => Promise<OAuth2Tokens>;
  verifyIdToken(token: string, nonce: string | undefined): Promise<boolean>;
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
  options: FacebookOptions;
};
//#endregion
export { FacebookOptions, FacebookProfile, facebook };
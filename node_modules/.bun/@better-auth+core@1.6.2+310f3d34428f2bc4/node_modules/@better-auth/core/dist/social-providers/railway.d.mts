import { OAuth2Tokens, ProviderOptions } from "../oauth2/oauth-provider.mjs";
//#region src/social-providers/railway.d.ts
interface RailwayProfile {
  /** The user's unique ID (OAuth `sub` claim). */
  sub: string;
  /** The user's email address. */
  email: string;
  /** The user's display name. */
  name: string;
  /** URL of the user's profile picture. */
  picture: string;
}
interface RailwayOptions extends ProviderOptions<RailwayProfile> {
  clientId: string;
}
declare const railway: (options: RailwayOptions) => {
  id: "railway";
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
  options: RailwayOptions;
};
//#endregion
export { RailwayOptions, RailwayProfile, railway };
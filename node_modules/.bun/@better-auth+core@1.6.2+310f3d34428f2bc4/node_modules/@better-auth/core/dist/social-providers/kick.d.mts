import { OAuth2Tokens, ProviderOptions } from "../oauth2/oauth-provider.mjs";
//#region src/social-providers/kick.d.ts
interface KickProfile {
  /**
   * The user id of the user
   */
  user_id: string;
  /**
   * The name of the user
   */
  name: string;
  /**
   * The email of the user
   */
  email: string;
  /**
   * The picture of the user
   */
  profile_picture: string;
}
interface KickOptions extends ProviderOptions<KickProfile> {
  clientId: string;
}
declare const kick: (options: KickOptions) => {
  id: "kick";
  name: string;
  createAuthorizationURL({
    state,
    scopes,
    redirectURI,
    codeVerifier
  }: {
    state: string;
    codeVerifier: string;
    scopes?: string[] | undefined;
    redirectURI: string;
    display?: string | undefined;
    loginHint?: string | undefined;
  }): Promise<URL>;
  validateAuthorizationCode({
    code,
    redirectURI,
    codeVerifier
  }: {
    code: string;
    redirectURI: string;
    codeVerifier?: string | undefined;
    deviceId?: string | undefined;
  }): Promise<OAuth2Tokens>;
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
  options: KickOptions;
};
//#endregion
export { KickOptions, KickProfile, kick };
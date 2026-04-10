import { OAuth2Tokens, ProviderOptions } from "../oauth2/oauth-provider.mjs";
//#region src/social-providers/twitch.d.ts
/**
 * @see https://dev.twitch.tv/docs/authentication/getting-tokens-oidc/#requesting-claims
 */
interface TwitchProfile {
  /**
   * The sub of the user
   */
  sub: string;
  /**
   * The preferred username of the user
   */
  preferred_username: string;
  /**
   * The email of the user
   */
  email: string;
  /**
   * Indicate if this user has a verified email.
   */
  email_verified: boolean;
  /**
   * The picture of the user
   */
  picture: string;
}
interface TwitchOptions extends ProviderOptions<TwitchProfile> {
  clientId: string;
  claims?: string[] | undefined;
}
declare const twitch: (options: TwitchOptions) => {
  id: "twitch";
  name: string;
  createAuthorizationURL({
    state,
    scopes,
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
  options: TwitchOptions;
};
//#endregion
export { TwitchOptions, TwitchProfile, twitch };
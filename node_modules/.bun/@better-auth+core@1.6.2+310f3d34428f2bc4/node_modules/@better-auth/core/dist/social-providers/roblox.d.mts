import { OAuth2Tokens, ProviderOptions } from "../oauth2/oauth-provider.mjs";
//#region src/social-providers/roblox.d.ts
interface RobloxProfile extends Record<string, any> {
  /** the user's id */
  sub: string;
  /** the user's username */
  preferred_username: string;
  /** the user's display name, will return the same value as the preferred_username if not set */
  nickname: string;
  /** the user's display name, again, will return the same value as the preferred_username if not set */
  name: string;
  /** the account creation date as a unix timestamp in seconds */
  created_at: number;
  /** the user's profile URL */
  profile: string;
  /** the user's avatar URL */
  picture: string;
}
interface RobloxOptions extends ProviderOptions<RobloxProfile> {
  clientId: string;
  prompt?: ("none" | "consent" | "login" | "select_account" | "select_account consent") | undefined;
}
declare const roblox: (options: RobloxOptions) => {
  id: "roblox";
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
  }): URL;
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
  options: RobloxOptions;
};
//#endregion
export { RobloxOptions, RobloxProfile, roblox };
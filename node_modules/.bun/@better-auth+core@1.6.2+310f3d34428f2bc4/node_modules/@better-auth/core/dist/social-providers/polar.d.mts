import { OAuth2Tokens, ProviderOptions } from "../oauth2/oauth-provider.mjs";
//#region src/social-providers/polar.d.ts
interface PolarProfile {
  id: string;
  email: string;
  username: string;
  avatar_url: string;
  github_username?: string | undefined;
  account_id?: string | undefined;
  public_name?: string | undefined;
  email_verified?: boolean | undefined;
  profile_settings?: {
    profile_settings_enabled?: boolean;
    profile_settings_public_name?: string;
    profile_settings_public_avatar?: string;
    profile_settings_public_bio?: string;
    profile_settings_public_location?: string;
    profile_settings_public_website?: string;
    profile_settings_public_twitter?: string;
    profile_settings_public_github?: string;
    profile_settings_public_email?: string;
  } | undefined;
}
interface PolarOptions extends ProviderOptions<PolarProfile> {}
declare const polar: (options: PolarOptions) => {
  id: "polar";
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
  options: PolarOptions;
};
//#endregion
export { PolarOptions, PolarProfile, polar };
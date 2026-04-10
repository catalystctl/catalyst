import { OAuth2Tokens, ProviderOptions } from "../oauth2/oauth-provider.mjs";
//#region src/social-providers/linear.d.ts
interface LinearUser {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string | undefined;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}
interface LinearProfile {
  data: {
    viewer: LinearUser;
  };
}
interface LinearOptions extends ProviderOptions<LinearUser> {
  clientId: string;
}
declare const linear: (options: LinearOptions) => {
  id: "linear";
  name: string;
  createAuthorizationURL({
    state,
    scopes,
    loginHint,
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
  options: LinearOptions;
};
//#endregion
export { LinearOptions, LinearProfile, LinearUser, linear };
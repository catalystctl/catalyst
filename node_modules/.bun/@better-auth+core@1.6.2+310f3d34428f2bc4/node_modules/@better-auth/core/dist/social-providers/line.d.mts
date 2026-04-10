import { OAuth2Tokens, ProviderOptions } from "../oauth2/oauth-provider.mjs";
//#region src/social-providers/line.d.ts
interface LineIdTokenPayload {
  iss: string;
  sub: string;
  aud: string;
  exp: number;
  iat: number;
  name?: string | undefined;
  picture?: string | undefined;
  email?: string | undefined;
  amr?: string[] | undefined;
  nonce?: string | undefined;
}
interface LineUserInfo {
  sub: string;
  name?: string | undefined;
  picture?: string | undefined;
  email?: string | undefined;
}
interface LineOptions extends ProviderOptions<LineUserInfo | LineIdTokenPayload> {
  clientId: string;
}
/**
 * LINE Login v2.1
 * - Authorization endpoint: https://access.line.me/oauth2/v2.1/authorize
 * - Token endpoint: https://api.line.me/oauth2/v2.1/token
 * - UserInfo endpoint: https://api.line.me/oauth2/v2.1/userinfo
 * - Verify ID token: https://api.line.me/oauth2/v2.1/verify
 *
 * Docs: https://developers.line.biz/en/reference/line-login/#issue-access-token
 */
declare const line: (options: LineOptions) => {
  id: "line";
  name: string;
  createAuthorizationURL({
    state,
    scopes,
    codeVerifier,
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
    codeVerifier,
    redirectURI
  }: {
    code: string;
    redirectURI: string;
    codeVerifier?: string | undefined;
    deviceId?: string | undefined;
  }) => Promise<OAuth2Tokens>;
  refreshAccessToken: (refreshToken: string) => Promise<OAuth2Tokens>;
  verifyIdToken(token: string, nonce: string | undefined): Promise<boolean>;
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
  } | {
    user: {
      id: any;
      name: any;
      email: any;
      image: any;
      emailVerified: false;
    } | {
      id: any;
      name: any;
      email: any;
      image: any;
      emailVerified: boolean;
    } | {
      id: any;
      name: any;
      email: any;
      image: any;
      emailVerified: boolean;
    };
    data: any;
  } | null>;
  options: LineOptions;
};
//#endregion
export { LineIdTokenPayload, LineOptions, LineUserInfo, line };
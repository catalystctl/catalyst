import { OAuth2Tokens, ProviderOptions } from "../oauth2/oauth-provider.mjs";
//#region src/social-providers/naver.d.ts
interface NaverProfile {
  /** API response result code */
  resultcode: string;
  /** API response message */
  message: string;
  response: {
    /** Unique Naver user identifier */id: string; /** User nickname */
    nickname: string; /** User real name */
    name: string; /** User email address */
    email: string; /** Gender (F: female, M: male, U: unknown) */
    gender: string; /** Age range */
    age: string; /** Birthday (MM-DD format) */
    birthday: string; /** Birth year */
    birthyear: string; /** Profile image URL */
    profile_image: string; /** Mobile phone number */
    mobile: string;
  };
}
interface NaverOptions extends ProviderOptions<NaverProfile> {
  clientId: string;
}
declare const naver: (options: NaverOptions) => {
  id: "naver";
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
  } | {
    user: {
      id: string;
      name: string;
      email: string;
      image: string;
      emailVerified: boolean;
    } | {
      id: string;
      name: string;
      email: string | null;
      image: string;
      emailVerified: boolean;
    } | {
      id: string;
      name: string;
      email: string | null;
      image: string;
      emailVerified: boolean;
    };
    data: NaverProfile;
  } | null>;
  options: NaverOptions;
};
//#endregion
export { NaverOptions, NaverProfile, naver };
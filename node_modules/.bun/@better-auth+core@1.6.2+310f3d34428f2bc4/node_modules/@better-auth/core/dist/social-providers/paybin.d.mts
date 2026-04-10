import { OAuth2Tokens, ProviderOptions } from "../oauth2/oauth-provider.mjs";
//#region src/social-providers/paybin.d.ts
interface PaybinProfile {
  sub: string;
  email: string;
  email_verified?: boolean | undefined;
  name?: string | undefined;
  preferred_username?: string | undefined;
  picture?: string | undefined;
  given_name?: string | undefined;
  family_name?: string | undefined;
}
interface PaybinOptions extends ProviderOptions<PaybinProfile> {
  clientId: string;
  /**
   * The issuer URL of your Paybin OAuth server
   * @default "https://idp.paybin.io"
   */
  issuer?: string | undefined;
}
declare const paybin: (options: PaybinOptions) => {
  id: "paybin";
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
  options: PaybinOptions;
};
//#endregion
export { PaybinOptions, PaybinProfile, paybin };
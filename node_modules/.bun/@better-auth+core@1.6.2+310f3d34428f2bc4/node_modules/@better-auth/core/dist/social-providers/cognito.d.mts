import { OAuth2Tokens, ProviderOptions } from "../oauth2/oauth-provider.mjs";
//#region src/social-providers/cognito.d.ts
interface CognitoProfile {
  sub: string;
  email: string;
  email_verified: boolean;
  name: string;
  given_name?: string | undefined;
  family_name?: string | undefined;
  picture?: string | undefined;
  username?: string | undefined;
  locale?: string | undefined;
  phone_number?: string | undefined;
  phone_number_verified?: boolean | undefined;
  aud: string;
  iss: string;
  exp: number;
  iat: number;
  [key: string]: any;
}
interface CognitoOptions extends ProviderOptions<CognitoProfile> {
  clientId: string;
  /**
   * The Cognito domain (e.g., "your-app.auth.us-east-1.amazoncognito.com")
   */
  domain: string;
  /**
   * AWS region where User Pool is hosted (e.g., "us-east-1")
   */
  region: string;
  userPoolId: string;
  requireClientSecret?: boolean | undefined;
}
declare const cognito: (options: CognitoOptions) => {
  id: "cognito";
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
  } | null>;
  options: CognitoOptions;
};
declare const getCognitoPublicKey: (kid: string, region: string, userPoolId: string) => Promise<Uint8Array<ArrayBufferLike> | CryptoKey>;
//#endregion
export { CognitoOptions, CognitoProfile, cognito, getCognitoPublicKey };
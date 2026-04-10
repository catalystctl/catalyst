import { OAuth2Tokens, ProviderOptions } from "../oauth2/oauth-provider.mjs";
//#region src/social-providers/apple.d.ts
interface AppleProfile {
  /**
   * The subject registered claim identifies the principal that’s the subject
   * of the identity token. Because this token is for your app, the value is
   * the unique identifier for the user.
   */
  sub: string;
  /**
   * A String value representing the user's email address.
   * The email address is either the user's real email address or the proxy
   * address, depending on their status private email relay service.
   */
  email: string;
  /**
   * A string or Boolean value that indicates whether the service verifies
   * the email. The value can either be a string ("true" or "false") or a
   * Boolean (true or false). The system may not verify email addresses for
   * Sign in with Apple at Work & School users, and this claim is "false" or
   * false for those users.
   */
  email_verified: true | "true";
  /**
   * A string or Boolean value that indicates whether the email that the user
   * shares is the proxy address. The value can either be a string ("true" or
   * "false") or a Boolean (true or false).
   */
  is_private_email: boolean;
  /**
   * An Integer value that indicates whether the user appears to be a real
   * person. Use the value of this claim to mitigate fraud. The possible
   * values are: 0 (or Unsupported), 1 (or Unknown), 2 (or LikelyReal). For
   * more information, see ASUserDetectionStatus. This claim is present only
   * in iOS 14 and later, macOS 11 and later, watchOS 7 and later, tvOS 14
   * and later. The claim isn’t present or supported for web-based apps.
   */
  real_user_status: number;
  /**
   * The user’s full name in the format provided during the authorization
   * process.
   */
  name: string;
  /**
   * The URL to the user's profile picture.
   */
  picture: string;
  user?: AppleNonConformUser | undefined;
}
/**
 * This is the shape of the `user` query parameter that Apple sends the first
 * time the user consents to the app.
 * @see https://developer.apple.com/documentation/signinwithapplerestapi/request-an-authorization-to-the-sign-in-with-apple-server./
 */
interface AppleNonConformUser {
  name: {
    firstName: string;
    lastName: string;
  };
  email: string;
}
interface AppleOptions extends ProviderOptions<AppleProfile> {
  clientId: string;
  appBundleIdentifier?: string | undefined;
  audience?: (string | string[]) | undefined;
}
declare const apple: (options: AppleOptions) => {
  id: "apple";
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
    codeVerifier,
    redirectURI
  }: {
    code: string;
    redirectURI: string;
    codeVerifier?: string | undefined;
    deviceId?: string | undefined;
  }) => Promise<OAuth2Tokens>;
  verifyIdToken(token: string, nonce: string | undefined): Promise<boolean>;
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
  options: AppleOptions;
};
declare const getApplePublicKey: (kid: string) => Promise<Uint8Array<ArrayBufferLike> | CryptoKey>;
//#endregion
export { AppleNonConformUser, AppleOptions, AppleProfile, apple, getApplePublicKey };
import { OAuth2Tokens, ProviderOptions } from "../oauth2/oauth-provider.mjs";
//#region src/social-providers/paypal.d.ts
interface PayPalProfile {
  user_id: string;
  name: string;
  given_name: string;
  family_name: string;
  middle_name?: string | undefined;
  picture?: string | undefined;
  email: string;
  email_verified: boolean;
  gender?: string | undefined;
  birthdate?: string | undefined;
  zoneinfo?: string | undefined;
  locale?: string | undefined;
  phone_number?: string | undefined;
  address?: {
    street_address?: string;
    locality?: string;
    region?: string;
    postal_code?: string;
    country?: string;
  } | undefined;
  verified_account?: boolean | undefined;
  account_type?: string | undefined;
  age_range?: string | undefined;
  payer_id?: string | undefined;
}
interface PayPalTokenResponse {
  scope?: string | undefined;
  access_token: string;
  refresh_token?: string | undefined;
  token_type: "Bearer";
  id_token?: string | undefined;
  expires_in: number;
  nonce?: string | undefined;
}
interface PayPalOptions extends ProviderOptions<PayPalProfile> {
  clientId: string;
  /**
   * PayPal environment - 'sandbox' for testing, 'live' for production
   * @default 'sandbox'
   */
  environment?: ("sandbox" | "live") | undefined;
  /**
   * Whether to request shipping address information
   * @default false
   */
  requestShippingAddress?: boolean | undefined;
}
declare const paypal: (options: PayPalOptions) => {
  id: "paypal";
  name: string;
  createAuthorizationURL({
    state,
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
    redirectURI
  }: {
    code: string;
    redirectURI: string;
    codeVerifier?: string | undefined;
    deviceId?: string | undefined;
  }) => Promise<{
    accessToken: string;
    refreshToken: string | undefined;
    accessTokenExpiresAt: Date | undefined;
    idToken: string | undefined;
  }>;
  refreshAccessToken: ((refreshToken: string) => Promise<OAuth2Tokens>) | ((refreshToken: string) => Promise<{
    accessToken: any;
    refreshToken: any;
    accessTokenExpiresAt: Date | undefined;
  }>);
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
      id: string;
      name: string;
      email: string;
      image: string | undefined;
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
    data: PayPalProfile;
  } | null>;
  options: PayPalOptions;
};
//#endregion
export { PayPalOptions, PayPalProfile, PayPalTokenResponse, paypal };
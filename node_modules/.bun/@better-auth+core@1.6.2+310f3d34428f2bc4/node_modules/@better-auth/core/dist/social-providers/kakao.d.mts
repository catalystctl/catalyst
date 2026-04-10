import { OAuth2Tokens, ProviderOptions } from "../oauth2/oauth-provider.mjs";
//#region src/social-providers/kakao.d.ts
interface Partner {
  /** Partner-specific ID (consent required: kakaotalk_message) */
  uuid?: string | undefined;
}
interface Profile {
  /** Nickname (consent required: profile/nickname) */
  nickname?: string | undefined;
  /** Thumbnail image URL (consent required: profile/profile image) */
  thumbnail_image_url?: string | undefined;
  /** Profile image URL (consent required: profile/profile image) */
  profile_image_url?: string | undefined;
  /** Whether the profile image is the default */
  is_default_image?: boolean | undefined;
  /** Whether the nickname is the default */
  is_default_nickname?: boolean | undefined;
}
interface KakaoAccount {
  /** Consent required: profile info (nickname/profile image) */
  profile_needs_agreement?: boolean | undefined;
  /** Consent required: nickname */
  profile_nickname_needs_agreement?: boolean | undefined;
  /** Consent required: profile image */
  profile_image_needs_agreement?: boolean | undefined;
  /** Profile info */
  profile?: Profile | undefined;
  /** Consent required: name */
  name_needs_agreement?: boolean | undefined;
  /** Name */
  name?: string | undefined;
  /** Consent required: email */
  email_needs_agreement?: boolean | undefined;
  /** Email valid */
  is_email_valid?: boolean | undefined;
  /** Email verified */
  is_email_verified?: boolean | undefined;
  /** Email */
  email?: string | undefined;
  /** Consent required: age range */
  age_range_needs_agreement?: boolean | undefined;
  /** Age range */
  age_range?: string | undefined;
  /** Consent required: birth year */
  birthyear_needs_agreement?: boolean | undefined;
  /** Birth year (YYYY) */
  birthyear?: string | undefined;
  /** Consent required: birthday */
  birthday_needs_agreement?: boolean | undefined;
  /** Birthday (MMDD) */
  birthday?: string | undefined;
  /** Birthday type (SOLAR/LUNAR) */
  birthday_type?: string | undefined;
  /** Whether birthday is in a leap month */
  is_leap_month?: boolean | undefined;
  /** Consent required: gender */
  gender_needs_agreement?: boolean | undefined;
  /** Gender (male/female) */
  gender?: string | undefined;
  /** Consent required: phone number */
  phone_number_needs_agreement?: boolean | undefined;
  /** Phone number */
  phone_number?: string | undefined;
  /** Consent required: CI */
  ci_needs_agreement?: boolean | undefined;
  /** CI (unique identifier) */
  ci?: string | undefined;
  /** CI authentication time (UTC) */
  ci_authenticated_at?: string | undefined;
}
interface KakaoProfile {
  /** Kakao user ID */
  id: number;
  /**
   * Whether the user has signed up (only present if auto-connection is disabled)
   * false: preregistered, true: registered
   */
  has_signed_up?: boolean | undefined;
  /** UTC datetime when the user connected the service */
  connected_at?: string | undefined;
  /** UTC datetime when the user signed up via Kakao Sync */
  synched_at?: string | undefined;
  /** Custom user properties */
  properties?: Record<string, any> | undefined;
  /** Kakao account info */
  kakao_account: KakaoAccount;
  /** Partner info */
  for_partner?: Partner | undefined;
}
interface KakaoOptions extends ProviderOptions<KakaoProfile> {
  clientId: string;
}
declare const kakao: (options: KakaoOptions) => {
  id: "kakao";
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
      email: string | undefined;
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
    data: KakaoProfile;
  } | null>;
  options: KakaoOptions;
};
//#endregion
export { KakaoOptions, KakaoProfile, kakao };
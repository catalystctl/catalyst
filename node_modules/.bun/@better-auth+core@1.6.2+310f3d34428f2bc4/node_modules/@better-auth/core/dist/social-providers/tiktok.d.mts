import { OAuth2Tokens, ProviderOptions } from "../oauth2/oauth-provider.mjs";
//#region src/social-providers/tiktok.d.ts
/**
 * [More info](https://developers.tiktok.com/doc/tiktok-api-v2-get-user-info/)
 */
interface TiktokProfile extends Record<string, any> {
  data: {
    user: {
      /**
       * The unique identification of the user in the current application.Open id
       * for the client.
       *
       * To return this field, add `fields=open_id` in the user profile request's query parameter.
       */
      open_id: string;
      /**
       * The unique identification of the user across different apps for the same developer.
       * For example, if a partner has X number of clients,
       * it will get X number of open_id for the same TikTok user,
       * but one persistent union_id for the particular user.
       *
       * To return this field, add `fields=union_id` in the user profile request's query parameter.
       */
      union_id?: string | undefined;
      /**
       * User's profile image.
       *
       * To return this field, add `fields=avatar_url` in the user profile request's query parameter.
       */
      avatar_url?: string | undefined;
      /**
       * User`s profile image in 100x100 size.
       *
       * To return this field, add `fields=avatar_url_100` in the user profile request's query parameter.
       */
      avatar_url_100?: string | undefined;
      /**
       * User's profile image with higher resolution
       *
       * To return this field, add `fields=avatar_url_100` in the user profile request's query parameter.
       */
      avatar_large_url: string;
      /**
       * User's profile name
       *
       * To return this field, add `fields=display_name` in the user profile request's query parameter.
       */
      display_name: string;
      /**
       * User's username.
       *
       * To return this field, add `fields=username` in the user profile request's query parameter.
       */
      username: string; /** @note Email is currently unsupported by TikTok  */
      email?: string | undefined;
      /**
       * User's bio description if there is a valid one.
       *
       * To return this field, add `fields=bio_description` in the user profile request's query parameter.
       */
      bio_description?: string | undefined;
      /**
       * The link to user's TikTok profile page.
       *
       * To return this field, add `fields=profile_deep_link` in the user profile request's query parameter.
       */
      profile_deep_link?: string | undefined;
      /**
       * Whether TikTok has provided a verified badge to the account after confirming
       * that it belongs to the user it represents.
       *
       * To return this field, add `fields=is_verified` in the user profile request's query parameter.
       */
      is_verified?: boolean | undefined;
      /**
       * User's followers count.
       *
       * To return this field, add `fields=follower_count` in the user profile request's query parameter.
       */
      follower_count?: number | undefined;
      /**
       * The number of accounts that the user is following.
       *
       * To return this field, add `fields=following_count` in the user profile request's query parameter.
       */
      following_count?: number | undefined;
      /**
       * The total number of likes received by the user across all of their videos.
       *
       * To return this field, add `fields=likes_count` in the user profile request's query parameter.
       */
      likes_count?: number | undefined;
      /**
       * The total number of publicly posted videos by the user.
       *
       * To return this field, add `fields=video_count` in the user profile request's query parameter.
       */
      video_count?: number | undefined;
    };
  };
  error?: {
    /**
     * The error category in string.
     */
    code?: string;
    /**
     * The error message in string.
     */
    message?: string;
    /**
     * The error message in string.
     */
    log_id?: string;
  } | undefined;
}
interface TiktokOptions extends ProviderOptions {
  clientId?: never | undefined;
  clientSecret: string;
  clientKey: string;
}
declare const tiktok: (options: TiktokOptions) => {
  id: "tiktok";
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
  options: TiktokOptions;
};
//#endregion
export { TiktokOptions, TiktokProfile, tiktok };
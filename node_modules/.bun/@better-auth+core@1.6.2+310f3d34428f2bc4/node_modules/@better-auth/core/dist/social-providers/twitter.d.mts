import { OAuth2Tokens, ProviderOptions } from "../oauth2/oauth-provider.mjs";
//#region src/social-providers/twitter.d.ts
interface TwitterProfile {
  data: {
    /**
     * Unique identifier of this user. This is returned as a string in order to avoid complications with languages and tools
     * that cannot handle large integers.
     */
    id: string; /** The friendly name of this user, as shown on their profile. */
    name: string; /** The email address of this user. */
    email?: string | undefined; /** The Twitter handle (screen name) of this user. */
    username: string;
    /**
     * The location specified in the user's profile, if the user provided one.
     * As this is a freeform value, it may not indicate a valid location, but it may be fuzzily evaluated when performing searches with location queries.
     *
     * To return this field, add `user.fields=location` in the authorization request's query parameter.
     */
    location?: string | undefined;
    /**
     * This object and its children fields contain details about text that has a special meaning in the user's description.
     *
     *To return this field, add `user.fields=entities` in the authorization request's query parameter.
     */
    entities?: {
      /** Contains details about the user's profile website. */url: {
        /** Contains details about the user's profile website. */urls: Array<{
          /** The start position (zero-based) of the recognized user's profile website. All start indices are inclusive. */start: number; /** The end position (zero-based) of the recognized user's profile website. This end index is exclusive. */
          end: number; /** The URL in the format entered by the user. */
          url: string; /** The fully resolved URL. */
          expanded_url: string; /** The URL as displayed in the user's profile. */
          display_url: string;
        }>;
      }; /** Contains details about URLs, Hashtags, Cashtags, or mentions located within a user's description. */
      description: {
        hashtags: Array<{
          start: number;
          end: number;
          tag: string;
        }>;
      };
    } | undefined;
    /**
     * Indicate if this user is a verified Twitter user.
     *
     * To return this field, add `user.fields=verified` in the authorization request's query parameter.
     */
    verified?: boolean | undefined;
    /**
     * The text of this user's profile description (also known as bio), if the user provided one.
     *
     * To return this field, add `user.fields=description` in the authorization request's query parameter.
     */
    description?: string | undefined;
    /**
     * The URL specified in the user's profile, if present.
     *
     * To return this field, add `user.fields=url` in the authorization request's query parameter.
     */
    url?: string | undefined; /** The URL to the profile image for this user, as shown on the user's profile. */
    profile_image_url?: string | undefined;
    protected?: boolean | undefined;
    /**
     * Unique identifier of this user's pinned Tweet.
     *
     *  You can obtain the expanded object in `includes.tweets` by adding `expansions=pinned_tweet_id` in the authorization request's query parameter.
     */
    pinned_tweet_id?: string | undefined;
    created_at?: string | undefined;
  };
  includes?: {
    tweets?: Array<{
      id: string;
      text: string;
    }>;
  } | undefined;
  [claims: string]: unknown;
}
interface TwitterOption extends ProviderOptions<TwitterProfile> {
  clientId: string;
}
declare const twitter: (options: TwitterOption) => {
  id: "twitter";
  name: string;
  createAuthorizationURL(data: {
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
      name? /** The start position (zero-based) of the recognized user's profile website. All start indices are inclusive. */: {
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
  options: TwitterOption;
};
//#endregion
export { TwitterOption, TwitterProfile, twitter };
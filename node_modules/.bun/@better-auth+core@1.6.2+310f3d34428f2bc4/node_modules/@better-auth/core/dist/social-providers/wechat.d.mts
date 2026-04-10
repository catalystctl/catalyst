import { OAuth2Tokens, ProviderOptions } from "../oauth2/oauth-provider.mjs";
//#region src/social-providers/wechat.d.ts
/**
 * WeChat user profile information
 * @see https://developers.weixin.qq.com/doc/oplatform/en/Website_App/WeChat_Login/Wechat_Login.html
 */
interface WeChatProfile extends Record<string, any> {
  /**
   * User's unique OpenID
   */
  openid: string;
  /**
   * User's nickname
   */
  nickname: string;
  /**
   * User's avatar image URL
   */
  headimgurl: string;
  /**
   * User's privileges
   */
  privilege: string[];
  /**
   * User's UnionID (unique across the developer's various applications)
   */
  unionid?: string;
  /** @note Email is currently unsupported by WeChat */
  email?: string;
}
interface WeChatOptions extends ProviderOptions<WeChatProfile> {
  /**
   * WeChat App ID
   */
  clientId: string;
  /**
   * WeChat App Secret
   */
  clientSecret: string;
  /**
   * Platform type for WeChat login
   * - Currently only supports "WebsiteApp" for WeChat Website Application (网站应用)
   * @default "WebsiteApp"
   */
  platformType?: "WebsiteApp";
  /**
   * UI language for the WeChat login page
   * cn for Simplified Chinese, en for English
   * @default "cn" if left undefined
   */
  lang?: "cn" | "en";
}
declare const wechat: (options: WeChatOptions) => {
  id: "wechat";
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
    code
  }: {
    code: string;
    redirectURI: string;
    codeVerifier?: string | undefined;
    deviceId?: string | undefined;
  }) => Promise<{
    tokenType: "Bearer";
    accessToken: string;
    refreshToken: string;
    accessTokenExpiresAt: Date;
    scopes: string[];
    openid: string;
    unionid: string | undefined;
  }>;
  refreshAccessToken: ((refreshToken: string) => Promise<OAuth2Tokens>) | ((refreshToken: string) => Promise<{
    tokenType: "Bearer";
    accessToken: string;
    refreshToken: string;
    accessTokenExpiresAt: Date;
    scopes: string[];
  }>);
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
  options: WeChatOptions;
};
//#endregion
export { WeChatOptions, WeChatProfile, wechat };
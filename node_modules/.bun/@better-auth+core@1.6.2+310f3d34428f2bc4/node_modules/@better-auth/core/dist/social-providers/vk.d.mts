import { OAuth2Tokens, ProviderOptions } from "../oauth2/oauth-provider.mjs";
//#region src/social-providers/vk.d.ts
interface VkProfile {
  user: {
    user_id: string;
    first_name: string;
    last_name: string;
    email?: string | undefined;
    phone?: number | undefined;
    avatar?: string | undefined;
    sex?: number | undefined;
    verified?: boolean | undefined;
    birthday: string;
  };
}
interface VkOption extends ProviderOptions {
  clientId: string;
  scheme?: ("light" | "dark") | undefined;
}
declare const vk: (options: VkOption) => {
  id: "vk";
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
    redirectURI,
    deviceId
  }: {
    code: string;
    redirectURI: string;
    codeVerifier?: string | undefined;
    deviceId?: string | undefined;
  }) => Promise<OAuth2Tokens>;
  refreshAccessToken: (refreshToken: string) => Promise<OAuth2Tokens>;
  getUserInfo(data: OAuth2Tokens & {
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
  options: VkOption;
};
//#endregion
export { VkOption, VkProfile, vk };
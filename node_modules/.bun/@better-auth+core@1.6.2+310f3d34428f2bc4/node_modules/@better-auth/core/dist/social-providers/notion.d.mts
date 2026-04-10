import { OAuth2Tokens, ProviderOptions } from "../oauth2/oauth-provider.mjs";
//#region src/social-providers/notion.d.ts
interface NotionProfile {
  object: "user";
  id: string;
  type: "person" | "bot";
  name?: string | undefined;
  avatar_url?: string | undefined;
  person?: {
    email?: string;
  } | undefined;
}
interface NotionOptions extends ProviderOptions<NotionProfile> {
  clientId: string;
}
declare const notion: (options: NotionOptions) => {
  id: "notion";
  name: string;
  createAuthorizationURL({
    state,
    scopes,
    loginHint,
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
  } | null>;
  options: NotionOptions;
};
//#endregion
export { NotionOptions, NotionProfile, notion };
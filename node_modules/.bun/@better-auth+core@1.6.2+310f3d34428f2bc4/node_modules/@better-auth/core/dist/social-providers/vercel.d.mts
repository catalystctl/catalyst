import { OAuth2Tokens, ProviderOptions } from "../oauth2/oauth-provider.mjs";
//#region src/social-providers/vercel.d.ts
interface VercelProfile {
  sub: string;
  name?: string;
  preferred_username?: string;
  email?: string;
  email_verified?: boolean;
  picture?: string;
}
interface VercelOptions extends ProviderOptions<VercelProfile> {
  clientId: string;
}
declare const vercel: (options: VercelOptions) => {
  id: "vercel";
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
  options: VercelOptions;
};
//#endregion
export { VercelOptions, VercelProfile, vercel };
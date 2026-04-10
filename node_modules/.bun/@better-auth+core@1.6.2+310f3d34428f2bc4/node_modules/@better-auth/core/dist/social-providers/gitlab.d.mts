import { OAuth2Tokens, ProviderOptions } from "../oauth2/oauth-provider.mjs";
//#region src/social-providers/gitlab.d.ts
interface GitlabProfile extends Record<string, any> {
  id: number;
  username: string;
  email: string;
  name: string;
  state: string;
  avatar_url: string;
  web_url: string;
  created_at: string;
  bio: string;
  location?: string | undefined;
  public_email: string;
  skype: string;
  linkedin: string;
  twitter: string;
  website_url: string;
  organization: string;
  job_title: string;
  pronouns: string;
  bot: boolean;
  work_information?: string | undefined;
  followers: number;
  following: number;
  local_time: string;
  last_sign_in_at: string;
  confirmed_at: string;
  theme_id: number;
  last_activity_on: string;
  color_scheme_id: number;
  projects_limit: number;
  current_sign_in_at: string;
  identities: Array<{
    provider: string;
    extern_uid: string;
  }>;
  can_create_group: boolean;
  can_create_project: boolean;
  two_factor_enabled: boolean;
  external: boolean;
  private_profile: boolean;
  commit_email: string;
  shared_runners_minutes_limit: number;
  extra_shared_runners_minutes_limit: number;
  email_verified?: boolean | undefined;
}
interface GitlabOptions extends ProviderOptions<GitlabProfile> {
  clientId: string;
  issuer?: string | undefined;
}
declare const gitlab: (options: GitlabOptions) => {
  id: "gitlab";
  name: string;
  createAuthorizationURL: ({
    state,
    scopes,
    codeVerifier,
    loginHint,
    redirectURI
  }: {
    state: string;
    codeVerifier: string;
    scopes?: string[] | undefined;
    redirectURI: string;
    display?: string | undefined;
    loginHint?: string | undefined;
  }) => Promise<URL>;
  validateAuthorizationCode: ({
    code,
    redirectURI,
    codeVerifier
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
      id: number;
      name: string;
      email: string;
      image: string;
      emailVerified: boolean;
    } | {
      id: string | number;
      name: string;
      email: string | null;
      image: string;
      emailVerified: boolean;
    } | {
      id: string | number;
      name: string;
      email: string | null;
      image: string;
      emailVerified: boolean;
    };
    data: GitlabProfile;
  } | null>;
  options: GitlabOptions;
};
//#endregion
export { GitlabOptions, GitlabProfile, gitlab };
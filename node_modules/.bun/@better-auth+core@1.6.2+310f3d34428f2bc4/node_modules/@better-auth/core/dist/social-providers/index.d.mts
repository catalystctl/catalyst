import { AppleNonConformUser, AppleOptions, AppleProfile, apple, getApplePublicKey } from "./apple.mjs";
import { AtlassianOptions, AtlassianProfile, atlassian } from "./atlassian.mjs";
import { CognitoOptions, CognitoProfile, cognito, getCognitoPublicKey } from "./cognito.mjs";
import { DiscordOptions, DiscordProfile, discord } from "./discord.mjs";
import { FacebookOptions, FacebookProfile, facebook } from "./facebook.mjs";
import { FigmaOptions, FigmaProfile, figma } from "./figma.mjs";
import { GithubOptions, GithubProfile, github } from "./github.mjs";
import { MicrosoftEntraIDProfile, MicrosoftOptions, getMicrosoftPublicKey, microsoft } from "./microsoft-entra-id.mjs";
import { GoogleOptions, GoogleProfile, getGooglePublicKey, google } from "./google.mjs";
import { HuggingFaceOptions, HuggingFaceProfile, huggingface } from "./huggingface.mjs";
import { SlackOptions, SlackProfile, slack } from "./slack.mjs";
import { SpotifyOptions, SpotifyProfile, spotify } from "./spotify.mjs";
import { TwitchOptions, TwitchProfile, twitch } from "./twitch.mjs";
import { TwitterOption, TwitterProfile, twitter } from "./twitter.mjs";
import { DropboxOptions, DropboxProfile, dropbox } from "./dropbox.mjs";
import { KickOptions, KickProfile, kick } from "./kick.mjs";
import { LinearOptions, LinearProfile, LinearUser, linear } from "./linear.mjs";
import { LinkedInOptions, LinkedInProfile, linkedin } from "./linkedin.mjs";
import { GitlabOptions, GitlabProfile, gitlab } from "./gitlab.mjs";
import { TiktokOptions, TiktokProfile, tiktok } from "./tiktok.mjs";
import { RedditOptions, RedditProfile, reddit } from "./reddit.mjs";
import { RobloxOptions, RobloxProfile, roblox } from "./roblox.mjs";
import { SalesforceOptions, SalesforceProfile, salesforce } from "./salesforce.mjs";
import { VkOption, VkProfile, vk } from "./vk.mjs";
import { AccountStatus, LoginType, PhoneNumber, PronounOption, ZoomOptions, ZoomProfile, zoom } from "./zoom.mjs";
import { NotionOptions, NotionProfile, notion } from "./notion.mjs";
import { KakaoOptions, KakaoProfile, kakao } from "./kakao.mjs";
import { NaverOptions, NaverProfile, naver } from "./naver.mjs";
import { LineIdTokenPayload, LineOptions, LineUserInfo, line } from "./line.mjs";
import { PaybinOptions, PaybinProfile, paybin } from "./paybin.mjs";
import { PayPalOptions, PayPalProfile, PayPalTokenResponse, paypal } from "./paypal.mjs";
import { PolarOptions, PolarProfile, polar } from "./polar.mjs";
import { RailwayOptions, RailwayProfile, railway } from "./railway.mjs";
import { VercelOptions, VercelProfile, vercel } from "./vercel.mjs";
import { WeChatOptions, WeChatProfile, wechat } from "./wechat.mjs";
import { AwaitableFunction } from "../types/helper.mjs";
import { OAuth2Tokens } from "../oauth2/oauth-provider.mjs";
import * as z from "zod";

//#region src/social-providers/index.d.ts
declare const socialProviders: {
  apple: (options: AppleOptions) => {
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
  atlassian: (options: AtlassianOptions) => {
    id: "atlassian";
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
    options: AtlassianOptions;
  };
  cognito: (options: CognitoOptions) => {
    id: "cognito";
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
    refreshAccessToken: (refreshToken: string) => Promise<OAuth2Tokens>;
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
    } | null>;
    options: CognitoOptions;
  };
  discord: (options: DiscordOptions) => {
    id: "discord";
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
    options: DiscordOptions;
  };
  facebook: (options: FacebookOptions) => {
    id: "facebook";
    name: string;
    createAuthorizationURL({
      state,
      scopes,
      redirectURI,
      loginHint
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
    options: FacebookOptions;
  };
  figma: (options: FigmaOptions) => {
    id: "figma";
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
    options: FigmaOptions;
  };
  github: (options: GithubOptions) => {
    id: "github";
    name: string;
    createAuthorizationURL({
      state,
      scopes,
      loginHint,
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
    }) => Promise<OAuth2Tokens | null>;
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
    options: GithubOptions;
  };
  microsoft: (options: MicrosoftOptions) => {
    id: "microsoft";
    name: string;
    createAuthorizationURL(data: {
      state: string;
      codeVerifier: string;
      scopes?: string[] | undefined;
      redirectURI: string;
      display?: string | undefined;
      loginHint?: string | undefined;
    }): Promise<URL>;
    validateAuthorizationCode({
      code,
      codeVerifier,
      redirectURI
    }: {
      code: string;
      redirectURI: string;
      codeVerifier?: string | undefined;
      deviceId?: string | undefined;
    }): Promise<OAuth2Tokens>;
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
    } | null>;
    refreshAccessToken: (refreshToken: string) => Promise<OAuth2Tokens>;
    options: MicrosoftOptions;
  };
  google: (options: GoogleOptions) => {
    id: "google";
    name: string;
    createAuthorizationURL({
      state,
      scopes,
      codeVerifier,
      redirectURI,
      loginHint,
      display
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
    refreshAccessToken: (refreshToken: string) => Promise<OAuth2Tokens>;
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
    } | null>;
    options: GoogleOptions;
  };
  huggingface: (options: HuggingFaceOptions) => {
    id: "huggingface";
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
    options: HuggingFaceOptions;
  };
  slack: (options: SlackOptions) => {
    id: "slack";
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
    options: SlackOptions;
  };
  spotify: (options: SpotifyOptions) => {
    id: "spotify";
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
    options: SpotifyOptions;
  };
  twitch: (options: TwitchOptions) => {
    id: "twitch";
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
    } | null>;
    options: TwitchOptions;
  };
  twitter: (options: TwitterOption) => {
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
    options: TwitterOption;
  };
  dropbox: (options: DropboxOptions) => {
    id: "dropbox";
    name: string;
    createAuthorizationURL: ({
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
    }) => Promise<URL>;
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
    options: DropboxOptions;
  };
  kick: (options: KickOptions) => {
    id: "kick";
    name: string;
    createAuthorizationURL({
      state,
      scopes,
      redirectURI,
      codeVerifier
    }: {
      state: string;
      codeVerifier: string;
      scopes?: string[] | undefined;
      redirectURI: string;
      display?: string | undefined;
      loginHint?: string | undefined;
    }): Promise<URL>;
    validateAuthorizationCode({
      code,
      redirectURI,
      codeVerifier
    }: {
      code: string;
      redirectURI: string;
      codeVerifier?: string | undefined;
      deviceId?: string | undefined;
    }): Promise<OAuth2Tokens>;
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
    options: KickOptions;
  };
  linear: (options: LinearOptions) => {
    id: "linear";
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
    options: LinearOptions;
  };
  linkedin: (options: LinkedInOptions) => {
    id: "linkedin";
    name: string;
    createAuthorizationURL: ({
      state,
      scopes,
      redirectURI,
      loginHint
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
    options: LinkedInOptions;
  };
  gitlab: (options: GitlabOptions) => {
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
  tiktok: (options: TiktokOptions) => {
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
  reddit: (options: RedditOptions) => {
    id: "reddit";
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
    } | null>;
    options: RedditOptions;
  };
  roblox: (options: RobloxOptions) => {
    id: "roblox";
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
    options: RobloxOptions;
  };
  salesforce: (options: SalesforceOptions) => {
    id: "salesforce";
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
    options: SalesforceOptions;
  };
  vk: (options: VkOption) => {
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
  zoom: (userOptions: ZoomOptions) => {
    id: "zoom";
    name: string;
    createAuthorizationURL: ({
      state,
      redirectURI,
      codeVerifier
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
    } | null>;
  };
  notion: (options: NotionOptions) => {
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
  kakao: (options: KakaoOptions) => {
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
  naver: (options: NaverOptions) => {
    id: "naver";
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
        email: string;
        image: string;
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
      data: NaverProfile;
    } | null>;
    options: NaverOptions;
  };
  line: (options: LineOptions) => {
    id: "line";
    name: string;
    createAuthorizationURL({
      state,
      scopes,
      codeVerifier,
      redirectURI,
      loginHint
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
    refreshAccessToken: (refreshToken: string) => Promise<OAuth2Tokens>;
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
        id: any;
        name: any;
        email: any;
        image: any;
        emailVerified: false;
      } | {
        id: any;
        name: any;
        email: any;
        image: any;
        emailVerified: boolean;
      } | {
        id: any;
        name: any;
        email: any;
        image: any;
        emailVerified: boolean;
      };
      data: any;
    } | null>;
    options: LineOptions;
  };
  paybin: (options: PaybinOptions) => {
    id: "paybin";
    name: string;
    createAuthorizationURL({
      state,
      scopes,
      codeVerifier,
      redirectURI,
      loginHint
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
    options: PaybinOptions;
  };
  paypal: (options: PayPalOptions) => {
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
  polar: (options: PolarOptions) => {
    id: "polar";
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
    options: PolarOptions;
  };
  railway: (options: RailwayOptions) => {
    id: "railway";
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
    options: RailwayOptions;
  };
  vercel: (options: VercelOptions) => {
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
  wechat: (options: WeChatOptions) => {
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
};
declare const socialProviderList: ["github", ...(keyof typeof socialProviders)[]];
declare const SocialProviderListEnum: z.ZodType<SocialProviderList[number] | (string & {})>;
type SocialProvider = z.infer<typeof SocialProviderListEnum>;
type SocialProviders = { [K in SocialProviderList[number]]?: AwaitableFunction<Parameters<(typeof socialProviders)[K]>[0] & {
  enabled?: boolean | undefined;
}> };
type SocialProviderList = typeof socialProviderList;
//#endregion
export { AccountStatus, AppleNonConformUser, AppleOptions, AppleProfile, AtlassianOptions, AtlassianProfile, CognitoOptions, CognitoProfile, DiscordOptions, DiscordProfile, DropboxOptions, DropboxProfile, FacebookOptions, FacebookProfile, FigmaOptions, FigmaProfile, GithubOptions, GithubProfile, GitlabOptions, GitlabProfile, GoogleOptions, GoogleProfile, HuggingFaceOptions, HuggingFaceProfile, KakaoOptions, KakaoProfile, KickOptions, KickProfile, LineIdTokenPayload, LineOptions, LineUserInfo, LinearOptions, LinearProfile, LinearUser, LinkedInOptions, LinkedInProfile, LoginType, MicrosoftEntraIDProfile, MicrosoftOptions, NaverOptions, NaverProfile, NotionOptions, NotionProfile, PayPalOptions, PayPalProfile, PayPalTokenResponse, PaybinOptions, PaybinProfile, PhoneNumber, PolarOptions, PolarProfile, PronounOption, RailwayOptions, RailwayProfile, RedditOptions, RedditProfile, RobloxOptions, RobloxProfile, SalesforceOptions, SalesforceProfile, SlackOptions, SlackProfile, SocialProvider, SocialProviderList, SocialProviderListEnum, SocialProviders, SpotifyOptions, SpotifyProfile, TiktokOptions, TiktokProfile, TwitchOptions, TwitchProfile, TwitterOption, TwitterProfile, VercelOptions, VercelProfile, VkOption, VkProfile, WeChatOptions, WeChatProfile, ZoomOptions, ZoomProfile, apple, atlassian, cognito, discord, dropbox, facebook, figma, getApplePublicKey, getCognitoPublicKey, getGooglePublicKey, getMicrosoftPublicKey, github, gitlab, google, huggingface, kakao, kick, line, linear, linkedin, microsoft, naver, notion, paybin, paypal, polar, railway, reddit, roblox, salesforce, slack, socialProviderList, socialProviders, spotify, tiktok, twitch, twitter, vercel, vk, wechat, zoom };
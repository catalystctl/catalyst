import { Session, User } from "../types/models.mjs";
import { CookieAttributes, HOST_COOKIE_PREFIX, SECURE_COOKIE_PREFIX, parseSetCookieHeader, setCookieToHeader, splitSetCookieHeader, stripSecureCookiePrefix } from "./cookie-utils.mjs";
import { createSessionStore, getAccountCookie, getChunkedCookie } from "./session-store.mjs";
import { BetterAuthCookie, BetterAuthCookies, BetterAuthOptions, GenericEndpointContext } from "@better-auth/core";
import * as better_call0 from "better-call";
import { CookieOptions } from "better-call";

//#region src/cookies/index.d.ts
declare function createCookieGetter(options: BetterAuthOptions): (cookieName: string, overrideAttributes?: Partial<CookieOptions>) => {
  name: string;
  attributes: {
    domain?: string;
    expires?: Date;
    httpOnly: boolean;
    maxAge?: number;
    path: string;
    secure: boolean;
    sameSite: "Strict" | "Lax" | "None" | "strict" | "lax" | "none";
    partitioned?: boolean;
    prefix?: better_call0.CookiePrefixOptions;
  };
};
declare function getCookies(options: BetterAuthOptions): {
  sessionToken: {
    name: string;
    attributes: {
      domain?: string;
      expires?: Date;
      httpOnly: boolean;
      maxAge?: number;
      path: string;
      secure: boolean;
      sameSite: "Strict" | "Lax" | "None" | "strict" | "lax" | "none";
      partitioned?: boolean;
      prefix?: better_call0.CookiePrefixOptions;
    };
  };
  /**
   * This cookie is used to store the session data in the cookie
   * This is useful for when you want to cache the session in the cookie
   */
  sessionData: {
    name: string;
    attributes: {
      domain?: string;
      expires?: Date;
      httpOnly: boolean;
      maxAge?: number;
      path: string;
      secure: boolean;
      sameSite: "Strict" | "Lax" | "None" | "strict" | "lax" | "none";
      partitioned?: boolean;
      prefix?: better_call0.CookiePrefixOptions;
    };
  };
  dontRememberToken: {
    name: string;
    attributes: {
      domain?: string;
      expires?: Date;
      httpOnly: boolean;
      maxAge?: number;
      path: string;
      secure: boolean;
      sameSite: "Strict" | "Lax" | "None" | "strict" | "lax" | "none";
      partitioned?: boolean;
      prefix?: better_call0.CookiePrefixOptions;
    };
  };
  accountData: {
    name: string;
    attributes: {
      domain?: string;
      expires?: Date;
      httpOnly: boolean;
      maxAge?: number;
      path: string;
      secure: boolean;
      sameSite: "Strict" | "Lax" | "None" | "strict" | "lax" | "none";
      partitioned?: boolean;
      prefix?: better_call0.CookiePrefixOptions;
    };
  };
};
declare function setCookieCache(ctx: GenericEndpointContext, session: {
  session: Session & Record<string, any>;
  user: User;
}, dontRememberMe: boolean): Promise<void>;
declare function setSessionCookie(ctx: GenericEndpointContext, session: {
  session: Session & Record<string, any>;
  user: User;
}, dontRememberMe?: boolean | undefined, overrides?: Partial<CookieOptions> | undefined): Promise<void>;
/**
 * Expires a cookie by setting `maxAge: 0` while preserving its attributes
 */
declare function expireCookie(ctx: GenericEndpointContext, cookie: BetterAuthCookie): void;
declare function deleteSessionCookie(ctx: GenericEndpointContext, skipDontRememberMe?: boolean | undefined): void;
declare function parseCookies(cookieHeader: string): Map<string, string>;
type EligibleCookies = (string & {}) | (keyof BetterAuthCookies & {});
declare const getSessionCookie: (request: Request | Headers, config?: {
  cookiePrefix?: string;
  cookieName?: string;
  path?: string;
} | undefined) => string | null;
declare const getCookieCache: <S extends {
  session: Session & Record<string, any>;
  user: User & Record<string, any>;
  updatedAt: number;
  version?: string;
}>(request: Request | Headers, config?: {
  cookiePrefix?: string;
  cookieName?: string;
  isSecure?: boolean;
  secret?: string;
  strategy?: "compact" | "jwt" | "jwe";
  version?: string | ((session: Session & Record<string, any>, user: User & Record<string, any>) => string) | ((session: Session & Record<string, any>, user: User & Record<string, any>) => Promise<string>);
} | undefined) => Promise<S | null>;
//#endregion
export { CookieAttributes, EligibleCookies, HOST_COOKIE_PREFIX, SECURE_COOKIE_PREFIX, createCookieGetter, createSessionStore, deleteSessionCookie, expireCookie, getAccountCookie, getChunkedCookie, getCookieCache, getCookies, getSessionCookie, parseCookies, parseSetCookieHeader, setCookieCache, setCookieToHeader, setSessionCookie, splitSetCookieHeader, stripSecureCookiePrefix };
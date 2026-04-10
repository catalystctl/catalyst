import { CookieOptions } from "better-call";

//#region src/types/cookie.d.ts
type BetterAuthCookie = {
  name: string;
  attributes: CookieOptions;
};
type BetterAuthCookies = {
  sessionToken: BetterAuthCookie;
  sessionData: BetterAuthCookie;
  accountData: BetterAuthCookie;
  dontRememberToken: BetterAuthCookie;
};
//#endregion
export { BetterAuthCookie, BetterAuthCookies };
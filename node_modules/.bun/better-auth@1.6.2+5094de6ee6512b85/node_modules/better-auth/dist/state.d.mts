import { GenericEndpointContext } from "@better-auth/core";
import { BetterAuthError } from "@better-auth/core/error";
import * as z from "zod";

//#region src/state.d.ts
declare const stateDataSchema: z.ZodObject<{
  callbackURL: z.ZodString;
  codeVerifier: z.ZodString;
  errorURL: z.ZodOptional<z.ZodString>;
  newUserURL: z.ZodOptional<z.ZodString>;
  expiresAt: z.ZodNumber;
  /**
   * CSRF nonce returned to the OAuth provider. When using cookie state storage,
   * this must match the callback `state` query parameter.
   */
  oauthState: z.ZodOptional<z.ZodString>;
  link: z.ZodOptional<z.ZodObject<{
    email: z.ZodString;
    userId: z.ZodCoercedString<unknown>;
  }, z.core.$strip>>;
  requestSignUp: z.ZodOptional<z.ZodBoolean>;
}, z.core.$loose>;
type StateData = z.infer<typeof stateDataSchema>;
declare function generateGenericState(c: GenericEndpointContext, stateData: StateData, settings?: {
  cookieName: string;
}): Promise<{
  state: string;
  codeVerifier: string;
}>;
declare function parseGenericState(c: GenericEndpointContext, state: string, settings?: {
  cookieName: string;
  skipStateCookieCheck?: boolean;
}): Promise<{
  [x: string]: unknown;
  callbackURL: string;
  codeVerifier: string;
  expiresAt: number;
  errorURL?: string | undefined;
  newUserURL?: string | undefined;
  oauthState?: string | undefined;
  link?: {
    email: string;
    userId: string;
  } | undefined;
  requestSignUp?: boolean | undefined;
}>;
//#endregion
export { StateData, generateGenericState, parseGenericState };
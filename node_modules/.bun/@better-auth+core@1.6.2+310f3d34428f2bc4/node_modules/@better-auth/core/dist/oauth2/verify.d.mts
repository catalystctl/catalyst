import { JSONWebKeySet, JWTPayload, JWTVerifyOptions } from "jose";

//#region src/oauth2/verify.d.ts
interface VerifyAccessTokenRemote {
  /** Full url of the introspect endpoint. Should end with `/oauth2/introspect` */
  introspectUrl: string;
  /** Client Secret */
  clientId: string;
  /** Client Secret */
  clientSecret: string;
  /**
   * Forces remote verification of a token.
   * This ensures attached session (if applicable)
   * is also still active.
   */
  force?: boolean;
}
/**
 * Performs local verification of an access token for your APIs.
 *
 * Can also be configured for remote verification.
 */
declare function verifyJwsAccessToken(token: string, opts: {
  /** Jwks url or promise of a Jwks */jwksFetch: string | (() => Promise<JSONWebKeySet | undefined>); /** Verify options */
  verifyOptions: JWTVerifyOptions & Required<Pick<JWTVerifyOptions, "audience" | "issuer">>;
}): Promise<JWTPayload>;
declare function getJwks(token: string, opts: {
  /** Jwks url or promise of a Jwks */jwksFetch: string | (() => Promise<JSONWebKeySet | undefined>);
}): Promise<JSONWebKeySet>;
/**
 * Performs local verification of an access token for your API.
 *
 * Can also be configured for remote verification.
 */
declare function verifyAccessToken(token: string, opts: {
  /** Verify options */verifyOptions: JWTVerifyOptions & Required<Pick<JWTVerifyOptions, "audience" | "issuer">>; /** Scopes to additionally verify. Token must include all but not exact. */
  scopes?: string[]; /** Required to verify access token locally */
  jwksUrl?: string; /** If provided, can verify a token remotely */
  remoteVerify?: VerifyAccessTokenRemote;
}): Promise<JWTPayload>;
//#endregion
export { getJwks, verifyAccessToken, verifyJwsAccessToken };
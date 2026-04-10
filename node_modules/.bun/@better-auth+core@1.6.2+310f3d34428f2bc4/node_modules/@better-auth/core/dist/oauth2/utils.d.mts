import { OAuth2Tokens } from "./oauth-provider.mjs";

//#region src/oauth2/utils.d.ts
declare function getOAuth2Tokens(data: Record<string, any>): OAuth2Tokens;
declare function generateCodeChallenge(codeVerifier: string): Promise<string>;
//#endregion
export { generateCodeChallenge, getOAuth2Tokens };
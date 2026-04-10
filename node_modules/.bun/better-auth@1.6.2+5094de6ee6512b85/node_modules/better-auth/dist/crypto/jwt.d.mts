import { SecretConfig } from "./index.mjs";

//#region src/crypto/jwt.d.ts
declare function signJWT(payload: any, secret: string, expiresIn?: number): Promise<string>;
declare function verifyJWT<T = any>(token: string, secret: string): Promise<T | null>;
declare function symmetricEncodeJWT<T extends Record<string, any>>(payload: T, secret: string | SecretConfig, salt: string, expiresIn?: number): Promise<string>;
declare function symmetricDecodeJWT<T = any>(token: string, secret: string | SecretConfig, salt: string): Promise<T | null>;
//#endregion
export { signJWT, symmetricDecodeJWT, symmetricEncodeJWT, verifyJWT };
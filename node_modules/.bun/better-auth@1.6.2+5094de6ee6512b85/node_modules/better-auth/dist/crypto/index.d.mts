import { constantTimeEqual } from "./buffer.mjs";
import { signJWT, symmetricDecodeJWT, symmetricEncodeJWT, verifyJWT } from "./jwt.mjs";
import { hashPassword, verifyPassword } from "./password.mjs";
import { generateRandomString } from "./random.mjs";
import { SecretConfig } from "@better-auth/core";

//#region src/crypto/index.d.ts
declare function parseEnvelope(data: string): {
  version: number;
  ciphertext: string;
} | null;
declare function formatEnvelope(version: number, ciphertext: string): string;
type SymmetricEncryptOptions = {
  key: string | SecretConfig;
  data: string;
};
declare const symmetricEncrypt: ({
  key,
  data
}: SymmetricEncryptOptions) => Promise<string>;
type SymmetricDecryptOptions = {
  key: string | SecretConfig;
  data: string;
};
declare const symmetricDecrypt: ({
  key,
  data
}: SymmetricDecryptOptions) => Promise<string>;
declare const getCryptoKey: (secret: string | BufferSource) => Promise<CryptoKey>;
declare const makeSignature: (value: string, secret: string | BufferSource) => Promise<string>;
//#endregion
export { type SecretConfig, SymmetricDecryptOptions, SymmetricEncryptOptions, constantTimeEqual, formatEnvelope, generateRandomString, getCryptoKey, hashPassword, makeSignature, parseEnvelope, signJWT, symmetricDecodeJWT, symmetricDecrypt, symmetricEncodeJWT, symmetricEncrypt, verifyJWT, verifyPassword };
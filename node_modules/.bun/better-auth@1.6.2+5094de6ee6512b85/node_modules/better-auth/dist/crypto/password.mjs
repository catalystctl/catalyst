import { hashPassword, verifyPassword } from "@better-auth/utils/password";
//#region src/crypto/password.ts
/**
* `@better-auth/utils/password` uses the "node" export condition in package.json
* to automatically pick the right implementation:
*   - Node.js / Bun / Deno → `node:crypto scrypt` (libuv thread pool, non-blocking)
*   - Unsupported runtimes → `@noble/hashes scrypt` (pure JS fallback)
*/
const hashPassword$1 = hashPassword;
const verifyPassword$1 = async ({ hash, password }) => {
	return verifyPassword(hash, password);
};
//#endregion
export { hashPassword$1 as hashPassword, verifyPassword$1 as verifyPassword };

import { base64Url } from "@better-auth/utils/base64";
import { createHash } from "@better-auth/utils/hash";
//#region src/plugins/one-time-token/utils.ts
const defaultKeyHasher = async (token) => {
	const hash = await createHash("SHA-256").digest(new TextEncoder().encode(token));
	return base64Url.encode(new Uint8Array(hash), { padding: false });
};
//#endregion
export { defaultKeyHasher };

import { base64Url } from "@better-auth/utils/base64";
import { createHash } from "@better-auth/utils/hash";
//#region src/plugins/magic-link/utils.ts
const defaultKeyHasher = async (otp) => {
	const hash = await createHash("SHA-256").digest(new TextEncoder().encode(otp));
	return base64Url.encode(new Uint8Array(hash), { padding: false });
};
//#endregion
export { defaultKeyHasher };

import { base64Url } from "@better-auth/utils/base64";
import { createHash } from "@better-auth/utils/hash";
//#region src/plugins/email-otp/utils.ts
function toOTPIdentifier(type, email) {
	return `${type}-otp-${email}`;
}
const defaultKeyHasher = async (otp) => {
	const hash = await createHash("SHA-256").digest(new TextEncoder().encode(otp));
	return base64Url.encode(new Uint8Array(hash), { padding: false });
};
function splitAtLastColon(input) {
	const idx = input.lastIndexOf(":");
	if (idx === -1) return [input, ""];
	return [input.slice(0, idx), input.slice(idx + 1)];
}
//#endregion
export { defaultKeyHasher, splitAtLastColon, toOTPIdentifier };

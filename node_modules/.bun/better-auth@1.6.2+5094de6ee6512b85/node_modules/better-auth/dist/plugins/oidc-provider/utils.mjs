import { base64Url } from "@better-auth/utils/base64";
import { createHash } from "@better-auth/utils/hash";
//#region src/plugins/oidc-provider/utils.ts
/**
* Default client secret hasher using SHA-256
*/
const defaultClientSecretHasher = async (clientSecret) => {
	const hash = await createHash("SHA-256").digest(new TextEncoder().encode(clientSecret));
	return base64Url.encode(new Uint8Array(hash), { padding: false });
};
//#endregion
export { defaultClientSecretHasher };

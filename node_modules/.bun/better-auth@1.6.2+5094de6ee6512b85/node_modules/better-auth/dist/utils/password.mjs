import { APIError, BASE_ERROR_CODES } from "@better-auth/core/error";
//#region src/utils/password.ts
async function validatePassword(ctx, data) {
	const credentialAccount = (await ctx.context.internalAdapter.findAccounts(data.userId))?.find((account) => account.providerId === "credential");
	const currentPassword = credentialAccount?.password;
	if (!credentialAccount || !currentPassword) return false;
	return await ctx.context.password.verify({
		hash: currentPassword,
		password: data.password
	});
}
async function checkPassword(userId, c) {
	const credentialAccount = (await c.context.internalAdapter.findAccounts(userId))?.find((account) => account.providerId === "credential");
	const currentPassword = credentialAccount?.password;
	const password = c.body.password;
	if (!credentialAccount || !currentPassword || !password) {
		if (password) await c.context.password.hash(password);
		throw APIError.from("BAD_REQUEST", BASE_ERROR_CODES.INVALID_PASSWORD);
	}
	if (!await c.context.password.verify({
		hash: currentPassword,
		password
	})) throw APIError.from("BAD_REQUEST", BASE_ERROR_CODES.INVALID_PASSWORD);
	return true;
}
async function shouldRequirePassword(ctx, userId, allowPasswordless) {
	if (!allowPasswordless) return true;
	const credentialAccount = (await ctx.context.internalAdapter.findAccounts(userId))?.find((account) => account.providerId === "credential" && account.password);
	return Boolean(credentialAccount);
}
//#endregion
export { checkPassword, shouldRequirePassword, validatePassword };

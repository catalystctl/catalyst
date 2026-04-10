import { createCookieHeaders, createTestCookie } from "./cookie-builder.mjs";
//#region src/plugins/test-utils/auth-helpers.ts
function createLogin(ctx) {
	return async (opts) => {
		const user = await ctx.internalAdapter.findUserById(opts.userId);
		if (!user) throw new Error(`User not found: ${opts.userId}`);
		const session = await ctx.internalAdapter.createSession(opts.userId);
		return {
			session,
			user,
			headers: await createCookieHeaders(ctx, session.token),
			cookies: await createTestCookie(ctx, session.token),
			token: session.token
		};
	};
}
function createGetAuthHeaders(ctx) {
	return async (opts) => {
		return createCookieHeaders(ctx, (await ctx.internalAdapter.createSession(opts.userId)).token);
	};
}
function createGetCookies(ctx) {
	return async (opts) => {
		return createTestCookie(ctx, (await ctx.internalAdapter.createSession(opts.userId)).token, opts.domain);
	};
}
//#endregion
export { createGetAuthHeaders, createGetCookies, createLogin };

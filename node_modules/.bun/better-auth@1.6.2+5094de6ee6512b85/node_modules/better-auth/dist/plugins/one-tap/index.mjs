import { parseUserOutput } from "../../db/schema.mjs";
import { setSessionCookie } from "../../cookies/index.mjs";
import { APIError } from "../../api/index.mjs";
import { PACKAGE_VERSION } from "../../version.mjs";
import { toBoolean } from "../../utils/boolean.mjs";
import { createAuthEndpoint } from "@better-auth/core/api";
import * as z from "zod";
import { createRemoteJWKSet, jwtVerify } from "jose";
//#region src/plugins/one-tap/index.ts
const oneTapCallbackBodySchema = z.object({ idToken: z.string().meta({ description: "Google ID token, which the client obtains from the One Tap API" }) });
const oneTap = (options) => ({
	id: "one-tap",
	version: PACKAGE_VERSION,
	endpoints: { oneTapCallback: createAuthEndpoint("/one-tap/callback", {
		method: "POST",
		body: oneTapCallbackBodySchema,
		metadata: { openapi: {
			summary: "One tap callback",
			description: "Use this endpoint to authenticate with Google One Tap",
			responses: {
				200: {
					description: "Successful response",
					content: { "application/json": { schema: {
						type: "object",
						properties: {
							session: { $ref: "#/components/schemas/Session" },
							user: { $ref: "#/components/schemas/User" }
						}
					} } }
				},
				400: { description: "Invalid token" }
			}
		} }
	}, async (ctx) => {
		const { idToken } = ctx.body;
		let payload;
		try {
			const JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
			const googleProvider = typeof ctx.context.options.socialProviders?.google === "function" ? await ctx.context.options.socialProviders?.google() : ctx.context.options.socialProviders?.google;
			const { payload: verifiedPayload } = await jwtVerify(idToken, JWKS, {
				issuer: ["https://accounts.google.com", "accounts.google.com"],
				audience: options?.clientId || googleProvider?.clientId
			});
			payload = verifiedPayload;
		} catch {
			throw new APIError("BAD_REQUEST", { message: "invalid id token" });
		}
		const { email, email_verified, name, picture, sub } = payload;
		if (!email) return ctx.json({ error: "Email not available in token" });
		const user = await ctx.context.internalAdapter.findUserByEmail(email);
		if (!user) {
			if (options?.disableSignup) throw new APIError("BAD_GATEWAY", { message: "User not found" });
			const newUser = await ctx.context.internalAdapter.createOAuthUser({
				email,
				emailVerified: typeof email_verified === "boolean" ? email_verified : toBoolean(email_verified),
				name,
				image: picture
			}, {
				providerId: "google",
				accountId: sub
			});
			if (!newUser) throw new APIError("INTERNAL_SERVER_ERROR", { message: "Could not create user" });
			const session = await ctx.context.internalAdapter.createSession(newUser.user.id);
			await setSessionCookie(ctx, {
				user: newUser.user,
				session
			});
			return ctx.json({
				token: session.token,
				user: parseUserOutput(ctx.context.options, newUser.user)
			});
		}
		if (!await ctx.context.internalAdapter.findAccount(sub)) if ((ctx.context.options.account?.accountLinking)?.enabled !== false && (ctx.context.trustedProviders.includes("google") || email_verified)) await ctx.context.internalAdapter.linkAccount({
			userId: user.user.id,
			providerId: "google",
			accountId: sub,
			scope: "openid,profile,email",
			idToken
		});
		else throw new APIError("UNAUTHORIZED", { message: "Google sub doesn't match" });
		const session = await ctx.context.internalAdapter.createSession(user.user.id);
		await setSessionCookie(ctx, {
			user: user.user,
			session
		});
		return ctx.json({
			token: session.token,
			user: parseUserOutput(ctx.context.options, user.user)
		});
	}) },
	options
});
//#endregion
export { oneTap };

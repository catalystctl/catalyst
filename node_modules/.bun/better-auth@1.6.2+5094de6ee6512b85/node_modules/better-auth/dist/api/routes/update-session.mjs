import { parseSessionInput, parseSessionOutput } from "../../db/schema.mjs";
import { setSessionCookie } from "../../cookies/index.mjs";
import { sessionMiddleware } from "./session.mjs";
import { APIError, BASE_ERROR_CODES } from "@better-auth/core/error";
import { createAuthEndpoint } from "@better-auth/core/api";
import * as z from "zod";
//#region src/api/routes/update-session.ts
const updateSessionBodySchema = z.record(z.string().meta({ description: "Field name must be a string" }), z.any());
const updateSession = () => createAuthEndpoint("/update-session", {
	method: "POST",
	operationId: "updateSession",
	body: updateSessionBodySchema,
	use: [sessionMiddleware],
	metadata: {
		$Infer: { body: {} },
		openapi: {
			operationId: "updateSession",
			description: "Update the current session",
			responses: { "200": {
				description: "Success",
				content: { "application/json": { schema: {
					type: "object",
					properties: { session: {
						type: "object",
						$ref: "#/components/schemas/Session"
					} }
				} } }
			} }
		}
	}
}, async (ctx) => {
	const body = ctx.body;
	if (typeof body !== "object" || Array.isArray(body)) throw APIError.from("BAD_REQUEST", BASE_ERROR_CODES.BODY_MUST_BE_AN_OBJECT);
	const session = ctx.context.session;
	const additionalFields = parseSessionInput(ctx.context.options, body, "update");
	if (Object.keys(additionalFields).length === 0) throw APIError.fromStatus("BAD_REQUEST", { message: "No fields to update" });
	const newSession = await ctx.context.internalAdapter.updateSession(session.session.token, {
		...additionalFields,
		updatedAt: /* @__PURE__ */ new Date()
	}) ?? {
		...session.session,
		...additionalFields,
		updatedAt: /* @__PURE__ */ new Date()
	};
	await setSessionCookie(ctx, {
		session: newSession,
		user: session.user
	});
	return ctx.json({ session: parseSessionOutput(ctx.context.options, newSession) });
});
//#endregion
export { updateSession };

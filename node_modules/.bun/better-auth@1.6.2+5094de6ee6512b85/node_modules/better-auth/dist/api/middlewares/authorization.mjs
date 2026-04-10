import { APIError } from "@better-auth/core/error";
import { createAuthMiddleware } from "@better-auth/core/api";
//#region src/api/middlewares/authorization.ts
/**
* Middleware that verifies the authenticated user owns a resource.
* Must be used after sessionMiddleware in the `use` array.
*
* Fetches the resource by ID from the request body or query,
* then verifies `resource[ownerField] === session.user.id`.
* Throws NOT_FOUND if the resource doesn't exist, FORBIDDEN if
* the user doesn't own it.
*
* The fetched resource is returned on `ctx.context.verifiedResource`
* so the handler can use it without a redundant DB query.
*/
function requireResourceOwnership(config) {
	const ownerField = config.ownerField ?? "userId";
	const forbiddenStatus = config.forbiddenStatus ?? "FORBIDDEN";
	return createAuthMiddleware(async (ctx) => {
		const session = ctx.context.session;
		if (!session?.user?.id) throw new APIError("UNAUTHORIZED");
		const resourceId = (config.idSource === "body" ? ctx.body : ctx.query)?.[config.idParam];
		if (!resourceId) throw new APIError("BAD_REQUEST", { message: `Missing required parameter: ${config.idParam}` });
		const resource = await ctx.context.adapter.findOne({
			model: config.model,
			where: [{
				field: "id",
				value: resourceId
			}]
		});
		if (!resource) {
			if (config.notFoundError) throw APIError.from("NOT_FOUND", config.notFoundError);
			throw new APIError("NOT_FOUND");
		}
		if (resource[ownerField] !== session.user.id) {
			if (config.forbiddenError) throw APIError.from(forbiddenStatus, config.forbiddenError);
			throw new APIError(forbiddenStatus);
		}
		return { verifiedResource: resource };
	});
}
/**
* Middleware that verifies the authenticated user is a member of a
* specific organization with one of the allowed roles.
* Must be used after sessionMiddleware in the `use` array.
*
* Looks up the member record by {userId, organizationId}, then checks
* the member's role against the allowed list.
*
* The verified member is returned on `ctx.context.verifiedMember`.
*/
function requireOrgRole(config) {
	const parseMemberRoles = (role) => role.split(",").map((entry) => entry.trim()).filter(Boolean);
	return createAuthMiddleware(async (ctx) => {
		const session = ctx.context.session;
		if (!session?.user?.id) throw new APIError("UNAUTHORIZED");
		if (!ctx.context.hasPlugin("organization")) throw new APIError("BAD_REQUEST", { message: "Organization plugin is required for org role authorization" });
		const organizationId = (config.orgIdSource === "body" ? ctx.body : ctx.query)?.[config.orgIdParam];
		if (!organizationId) throw new APIError("BAD_REQUEST", { message: `Missing required parameter: ${config.orgIdParam}` });
		const member = await ctx.context.adapter.findOne({
			model: "member",
			where: [{
				field: "userId",
				value: session.user.id
			}, {
				field: "organizationId",
				value: organizationId
			}]
		});
		if (!member) throw new APIError("FORBIDDEN", { message: "Not a member of this organization" });
		if (config.allowedRoles?.length) {
			if (!parseMemberRoles(member.role ?? "").some((role) => config.allowedRoles.includes(role))) throw new APIError("FORBIDDEN", { message: "Insufficient role for this operation" });
		}
		return { verifiedMember: member };
	});
}
//#endregion
export { requireOrgRole, requireResourceOwnership };

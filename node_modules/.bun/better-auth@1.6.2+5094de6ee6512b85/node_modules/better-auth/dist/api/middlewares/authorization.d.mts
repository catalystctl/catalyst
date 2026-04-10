import * as better_call0 from "better-call";

//#region src/api/middlewares/authorization.d.ts
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
declare function requireResourceOwnership(config: {
  /** Database model name (e.g., "passkey", "apiKey") */model: string; /** Request parameter name containing the resource ID */
  idParam: string; /** Where to find the ID: "body" or "query" */
  idSource: "body" | "query"; /** Field on the resource that holds the owner's user ID. Default: "userId" */
  ownerField?: string;
  /**
   * Custom error to throw when the resource is not found.
   * Accepts a `{ code, message }` from `defineErrorCodes`.
   * Default: generic NOT_FOUND.
   */
  notFoundError?: {
    code: string;
    message: string;
  };
  /**
   * Custom error to throw when the user doesn't own the resource.
   * Accepts a `{ code, message }` from `defineErrorCodes`.
   * Default: generic FORBIDDEN.
   */
  forbiddenError?: {
    code: string;
    message: string;
  };
  /**
   * HTTP status for ownership failures.
   * @default "FORBIDDEN" (403)
   */
  forbiddenStatus?: "FORBIDDEN" | "UNAUTHORIZED";
}): (inputContext: better_call0.MiddlewareInputContext<better_call0.MiddlewareOptions>) => Promise<{
  verifiedResource: {};
}>;
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
declare function requireOrgRole(config: {
  /** Request parameter name containing the organization ID */orgIdParam: string; /** Where to find the org ID: "body" or "query" */
  orgIdSource: "body" | "query";
  /**
   * Roles that are authorized to proceed. If omitted or empty,
   * any org membership is sufficient.
   */
  allowedRoles?: string[];
}): (inputContext: better_call0.MiddlewareInputContext<better_call0.MiddlewareOptions>) => Promise<{
  verifiedMember: {};
}>;
//#endregion
export { requireOrgRole, requireResourceOwnership };
import { PACKAGE_VERSION } from "../../version.mjs";
import { useAuthQuery } from "../../client/query.mjs";
import { adminAc, defaultRoles, memberAc, ownerAc } from "./access/statement.mjs";
import { ORGANIZATION_ERROR_CODES } from "./error-codes.mjs";
import { hasPermissionFn } from "./permission.mjs";
import { atom } from "nanostores";
//#region src/plugins/organization/client.ts
/**
* Using the same `hasPermissionFn` function, but without the need for a `ctx` parameter or the `organizationId` parameter.
*/
const clientSideHasPermission = (input) => {
	return hasPermissionFn(input, input.options.roles || defaultRoles);
};
const organizationClient = (options) => {
	const $listOrg = atom(false);
	const $activeOrgSignal = atom(false);
	const $activeMemberSignal = atom(false);
	const $activeMemberRoleSignal = atom(false);
	const roles = {
		admin: adminAc,
		member: memberAc,
		owner: ownerAc,
		...options?.roles
	};
	return {
		id: "organization",
		version: PACKAGE_VERSION,
		$InferServerPlugin: {},
		getActions: ($fetch, _$store, co) => ({
			$Infer: {
				ActiveOrganization: {},
				Organization: {},
				Invitation: {},
				Member: {},
				Team: {}
			},
			organization: { checkRolePermission: (data) => {
				return clientSideHasPermission({
					role: data.role,
					options: {
						ac: options?.ac,
						roles
					},
					permissions: data.permissions
				});
			} }
		}),
		getAtoms: ($fetch) => {
			const listOrganizations = useAuthQuery($listOrg, "/organization/list", $fetch, { method: "GET" });
			return {
				$listOrg,
				$activeOrgSignal,
				$activeMemberSignal,
				$activeMemberRoleSignal,
				activeOrganization: useAuthQuery([$activeOrgSignal], "/organization/get-full-organization", $fetch, () => ({ method: "GET" })),
				listOrganizations,
				activeMember: useAuthQuery([$activeOrgSignal, $activeMemberSignal], "/organization/get-active-member", $fetch, { method: "GET" }),
				activeMemberRole: useAuthQuery([$activeOrgSignal, $activeMemberRoleSignal], "/organization/get-active-member-role", $fetch, { method: "GET" })
			};
		},
		pathMethods: {
			"/organization/get-full-organization": "GET",
			"/organization/list-user-teams": "GET"
		},
		atomListeners: [
			{
				matcher(path) {
					return path === "/organization/create" || path === "/organization/delete" || path === "/organization/update";
				},
				signal: "$listOrg"
			},
			{
				matcher(path) {
					return path.startsWith("/organization");
				},
				signal: "$activeOrgSignal"
			},
			{
				matcher(path) {
					return path.startsWith("/organization/set-active") || path === "/organization/create" || path === "/organization/delete" || path === "/organization/remove-member" || path === "/organization/leave" || path === "/organization/accept-invitation";
				},
				signal: "$sessionSignal"
			},
			{
				matcher(path) {
					return path.includes("/organization/update-member-role") || path.startsWith("/organization/set-active");
				},
				signal: "$activeMemberSignal"
			},
			{
				matcher(path) {
					return path.includes("/organization/update-member-role") || path.startsWith("/organization/set-active");
				},
				signal: "$activeMemberRoleSignal"
			}
		],
		$ERROR_CODES: ORGANIZATION_ERROR_CODES
	};
};
const inferOrgAdditionalFields = (schema) => {
	return {};
};
//#endregion
export { clientSideHasPermission, inferOrgAdditionalFields, organizationClient };

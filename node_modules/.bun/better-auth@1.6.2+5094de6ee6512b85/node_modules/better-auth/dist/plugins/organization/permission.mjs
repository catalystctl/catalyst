//#region src/plugins/organization/permission.ts
const hasPermissionFn = (input, acRoles) => {
	if (!input.permissions) return false;
	const roles = input.role.split(",");
	const creatorRole = input.options.creatorRole || "owner";
	const isCreator = roles.includes(creatorRole);
	const allowCreatorsAllPermissions = input.allowCreatorAllPermissions || false;
	if (isCreator && allowCreatorsAllPermissions) return true;
	for (const role of roles) if ((acRoles[role]?.authorize(input.permissions))?.success) return true;
	return false;
};
const cacheAllRoles = /* @__PURE__ */ new Map();
//#endregion
export { cacheAllRoles, hasPermissionFn };

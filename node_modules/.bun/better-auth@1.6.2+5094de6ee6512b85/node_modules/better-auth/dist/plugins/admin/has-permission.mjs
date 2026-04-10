import { defaultRoles } from "./access/statement.mjs";
//#region src/plugins/admin/has-permission.ts
const hasPermission = (input) => {
	if (input.userId && input.options?.adminUserIds?.includes(input.userId)) return true;
	if (!input.permissions) return false;
	const roles = (input.role || input.options?.defaultRole || "user").split(",");
	const acRoles = input.options?.roles || defaultRoles;
	for (const role of roles) if ((acRoles[role]?.authorize(input.permissions))?.success) return true;
	return false;
};
//#endregion
export { hasPermission };

import { createAccessControl } from "../../access/access.mjs";
//#region src/plugins/admin/access/statement.ts
const defaultStatements = {
	user: [
		"create",
		"list",
		"set-role",
		"ban",
		"impersonate",
		"impersonate-admins",
		"delete",
		"set-password",
		"get",
		"update"
	],
	session: [
		"list",
		"revoke",
		"delete"
	]
};
const defaultAc = createAccessControl(defaultStatements);
const adminAc = defaultAc.newRole({
	user: [
		"create",
		"list",
		"set-role",
		"ban",
		"impersonate",
		"delete",
		"set-password",
		"get",
		"update"
	],
	session: [
		"list",
		"revoke",
		"delete"
	]
});
const userAc = defaultAc.newRole({
	user: [],
	session: []
});
const defaultRoles = {
	admin: adminAc,
	user: userAc
};
//#endregion
export { adminAc, defaultAc, defaultRoles, defaultStatements, userAc };

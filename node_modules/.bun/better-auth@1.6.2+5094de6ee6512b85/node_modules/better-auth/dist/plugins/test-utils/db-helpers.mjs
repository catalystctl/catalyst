import { generateRandomString } from "../../crypto/random.mjs";
//#region src/plugins/test-utils/db-helpers.ts
function createSaveUser(ctx) {
	return async (user) => {
		return ctx.internalAdapter.createUser(user);
	};
}
function createDeleteUser(ctx) {
	return async (userId) => {
		await ctx.internalAdapter.deleteUser(userId);
	};
}
function createSaveOrganization(ctx) {
	return async (org) => {
		return await ctx.adapter.create({
			model: "organization",
			data: org,
			forceAllowId: true
		});
	};
}
function createDeleteOrganization(ctx) {
	return async (orgId) => {
		await ctx.adapter.deleteMany({
			model: "member",
			where: [{
				field: "organizationId",
				value: orgId
			}]
		});
		await ctx.adapter.deleteMany({
			model: "invitation",
			where: [{
				field: "organizationId",
				value: orgId
			}]
		});
		await ctx.adapter.delete({
			model: "organization",
			where: [{
				field: "id",
				value: orgId
			}]
		});
	};
}
function createAddMember(ctx) {
	return async (opts) => {
		const generatedId = ctx.generateId({ model: "member" });
		const id = generatedId === false ? generateRandomString(24, "a-z", "A-Z", "0-9") : generatedId;
		return await ctx.adapter.create({
			model: "member",
			data: {
				id,
				userId: opts.userId,
				organizationId: opts.organizationId,
				role: opts.role || "member",
				createdAt: /* @__PURE__ */ new Date()
			},
			forceAllowId: true
		});
	};
}
//#endregion
export { createAddMember, createDeleteOrganization, createDeleteUser, createSaveOrganization, createSaveUser };

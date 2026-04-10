import { generateRandomString } from "../../crypto/random.mjs";
//#region src/plugins/test-utils/factories.ts
function createUserFactory(ctx) {
	return (overrides = {}) => {
		const generatedId = ctx.generateId({ model: "user" });
		const id = overrides.id || (generatedId === false ? generateRandomString(24, "a-z", "A-Z", "0-9") : generatedId);
		const now = /* @__PURE__ */ new Date();
		return {
			id,
			email: overrides.email || `test-${generateRandomString(8, "a-z", "0-9")}@example.com`,
			name: overrides.name || "Test User",
			emailVerified: overrides.emailVerified ?? true,
			image: overrides.image ?? null,
			createdAt: overrides.createdAt || now,
			updatedAt: overrides.updatedAt || now,
			...overrides
		};
	};
}
function createOrganizationFactory(ctx) {
	return (overrides = {}) => {
		const generatedId = ctx.generateId({ model: "organization" });
		const id = overrides.id || (generatedId === false ? generateRandomString(24, "a-z", "A-Z", "0-9") : generatedId);
		const now = /* @__PURE__ */ new Date();
		const name = overrides.name || "Test Organization";
		return {
			id,
			name,
			slug: overrides.slug || `${name.toLowerCase().replace(/\s+/g, "-")}-${generateRandomString(4, "a-z", "0-9")}`,
			logo: overrides.logo ?? null,
			metadata: overrides.metadata ?? null,
			createdAt: overrides.createdAt || now,
			...overrides
		};
	};
}
//#endregion
export { createOrganizationFactory, createUserFactory };

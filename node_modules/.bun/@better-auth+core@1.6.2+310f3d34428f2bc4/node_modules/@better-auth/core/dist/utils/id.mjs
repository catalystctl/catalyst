import { createRandomStringGenerator } from "@better-auth/utils/random";
//#region src/utils/id.ts
const generateId = (size) => {
	return createRandomStringGenerator("a-z", "A-Z", "0-9")(size || 32);
};
//#endregion
export { generateId };

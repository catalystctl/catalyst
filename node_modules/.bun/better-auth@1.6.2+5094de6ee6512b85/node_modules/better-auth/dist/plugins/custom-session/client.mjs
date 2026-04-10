import { InferServerPlugin } from "../../client/plugins/infer-plugin.mjs";
//#region src/plugins/custom-session/client.ts
const customSessionClient = () => {
	return InferServerPlugin();
};
//#endregion
export { customSessionClient };

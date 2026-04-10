import { magicLink } from "./index.mjs";

//#region src/plugins/magic-link/client.d.ts
declare const magicLinkClient: () => {
  id: "magic-link";
  version: string;
  $InferServerPlugin: ReturnType<typeof magicLink>;
};
//#endregion
export { magicLinkClient };
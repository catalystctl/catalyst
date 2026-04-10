import { siwe } from "./index.mjs";

//#region src/plugins/siwe/client.d.ts
declare const siweClient: () => {
  id: "siwe";
  version: string;
  $InferServerPlugin: ReturnType<typeof siwe>;
};
//#endregion
export { siweClient };
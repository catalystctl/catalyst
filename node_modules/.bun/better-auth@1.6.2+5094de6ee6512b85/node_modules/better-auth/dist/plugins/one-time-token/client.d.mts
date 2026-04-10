import { OneTimeTokenOptions, oneTimeToken } from "./index.mjs";

//#region src/plugins/one-time-token/client.d.ts
declare const oneTimeTokenClient: () => {
  id: "one-time-token";
  version: string;
  $InferServerPlugin: ReturnType<typeof oneTimeToken>;
};
//#endregion
export { oneTimeTokenClient };
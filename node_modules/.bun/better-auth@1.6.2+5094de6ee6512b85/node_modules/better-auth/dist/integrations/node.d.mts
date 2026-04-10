import { Auth } from "../types/auth.mjs";
import * as node_http0 from "node:http";
import { IncomingHttpHeaders } from "node:http";

//#region src/integrations/node.d.ts
declare const toNodeHandler: (auth: {
  handler: Auth["handler"];
} | Auth["handler"]) => (req: node_http0.IncomingMessage, res: node_http0.ServerResponse) => Promise<void>;
declare function fromNodeHeaders(nodeHeaders: IncomingHttpHeaders): Headers;
//#endregion
export { fromNodeHeaders, toNodeHandler };
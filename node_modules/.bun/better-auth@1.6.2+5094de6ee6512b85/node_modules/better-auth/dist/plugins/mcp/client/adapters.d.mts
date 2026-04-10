import { McpAuthClient, McpAuthClientOptions, McpSession } from "./index.mjs";

//#region src/plugins/mcp/client/adapters.d.ts
interface HonoContext {
  req: {
    header: (name: string) => string | undefined;
    raw: Request;
  };
  set: (key: string, value: unknown) => void;
  json: (data: unknown, status?: number, headers?: Record<string, string>) => Response;
  header: (name: string, value: string) => void;
}
type HonoNext = () => Promise<void>;
type HonoMiddleware = (c: HonoContext, next: HonoNext) => Promise<Response | void>;
interface HonoApp {
  get: (path: string, handler: (c: HonoContext) => Promise<Response>) => void;
}
declare function mcpAuthHono(options: McpAuthClientOptions): {
  client: McpAuthClient;
  middleware: HonoMiddleware;
  discoveryRoutes: (app: HonoApp, serverURL: string) => void;
};
declare function mcpAuthOfficial(options: McpAuthClientOptions): {
  client: McpAuthClient;
  handler: McpAuthClient["handler"];
  verifyToken: McpAuthClient["verifyToken"];
};
type OAuthMode = "direct" | "proxy";
interface McpUseUserInfo {
  userId: string;
  roles?: string[];
  permissions?: string[];
  scopes?: string;
  clientId?: string;
  [key: string]: unknown;
}
interface OAuthProvider {
  verifyToken(token: string): Promise<{
    payload: Record<string, unknown>;
  }>;
  getUserInfo(payload: Record<string, unknown>): McpUseUserInfo;
  getIssuer(): string;
  getAuthEndpoint(): string;
  getTokenEndpoint(): string;
  getScopesSupported(): string[];
  getGrantTypesSupported(): string[];
  getMode(): OAuthMode;
  getRegistrationEndpoint?(): string;
}
interface McpUseBetterAuthConfig {
  authURL: string;
  getUserInfo?: (payload: Record<string, unknown>) => McpUseUserInfo;
}
declare function mcpAuthMcpUse(config: McpUseBetterAuthConfig): OAuthProvider;
//#endregion
export { type McpAuthClient, type McpAuthClientOptions, type McpSession, McpUseBetterAuthConfig, mcpAuthHono, mcpAuthMcpUse, mcpAuthOfficial };
//#region src/plugins/mcp/client/index.d.ts
interface McpAuthClientOptions {
  authURL: string;
  resource?: string;
  allowedOrigin?: string;
  fetch?: typeof globalThis.fetch;
}
interface McpSession {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string;
  refreshTokenExpiresAt: string;
  clientId: string;
  userId: string;
  scopes: string;
}
interface NodeLikeRequest {
  headers: Record<string, string | string[] | undefined> & {
    get?: (name: string) => string | undefined;
    authorization?: string;
  };
  get?: (name: string) => string | undefined;
  mcpSession?: McpSession;
}
interface NodeLikeResponse {
  set?: (name: string, value: string) => void;
  setHeader?: (name: string, value: string) => void;
  status?: (code: number) => {
    json: (body: unknown) => void;
  };
  writeHead?: (code: number, headers: Record<string, string>) => void;
  end?: (body: string) => void;
}
interface McpAuthClient {
  verifyToken: (token: string) => Promise<McpSession | null>;
  handler: (fn: (req: Request, session: McpSession) => Response | Promise<Response>) => (req: Request) => Promise<Response>;
  discoveryHandler: () => (req: Request) => Promise<Response>;
  protectedResourceHandler: (serverURL: string) => (req: Request) => Promise<Response>;
  middleware: () => (req: NodeLikeRequest, res: NodeLikeResponse, next: () => void) => Promise<void>;
  authURL: string;
}
declare function createMcpAuthClient(options: McpAuthClientOptions): McpAuthClient;
//#endregion
export { McpAuthClient, McpAuthClientOptions, McpSession, createMcpAuthClient };
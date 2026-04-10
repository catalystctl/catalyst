import { createMcpAuthClient } from "./index.mjs";
//#region src/plugins/mcp/client/adapters.ts
function mcpAuthHono(options) {
	const client = createMcpAuthClient(options);
	const resourceBase = options.resource ?? client.authURL;
	const middleware = async (c, next) => {
		const authHeader = c.req.header("Authorization");
		const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : void 0;
		if (!token) {
			c.header("WWW-Authenticate", `Bearer resource_metadata="${resourceBase}/.well-known/oauth-protected-resource"`);
			return c.json({
				jsonrpc: "2.0",
				error: {
					code: -32e3,
					message: "Unauthorized: Authentication required"
				},
				id: null
			}, 401);
		}
		const session = await client.verifyToken(token);
		if (!session) {
			c.header("WWW-Authenticate", `Bearer resource_metadata="${resourceBase}/.well-known/oauth-protected-resource"`);
			return c.json({
				jsonrpc: "2.0",
				error: {
					code: -32e3,
					message: "Invalid or expired token"
				},
				id: null
			}, 401);
		}
		c.set("mcpSession", session);
		await next();
	};
	const discoveryRoutes = (app, serverURL) => {
		const discoveryFn = client.discoveryHandler();
		const protectedResourceFn = client.protectedResourceHandler(serverURL);
		app.get("/.well-known/oauth-authorization-server", async (c) => {
			const response = await discoveryFn(c.req.raw);
			const data = await response.json().catch(() => ({ error: "Invalid response from auth server" }));
			return c.json(data, response.status);
		});
		app.get("/.well-known/oauth-protected-resource", async (c) => {
			const response = await protectedResourceFn(c.req.raw);
			const data = await response.json().catch(() => ({ error: "Invalid response from auth server" }));
			return c.json(data, response.status);
		});
	};
	return {
		client,
		middleware,
		discoveryRoutes
	};
}
function mcpAuthOfficial(options) {
	const client = createMcpAuthClient(options);
	return {
		client,
		handler: client.handler,
		verifyToken: client.verifyToken
	};
}
function mcpAuthMcpUse(config) {
	const authURL = normalizeURL(config.authURL);
	if (!authURL) throw new Error("Better Auth authURL is required. Pass authURL in config, e.g.: mcpAuthMcpUse({ authURL: 'http://localhost:3000/api/auth' })");
	const client = createMcpAuthClient({ authURL });
	return {
		async verifyToken(token) {
			const session = await client.verifyToken(token);
			if (!session) throw new Error("Invalid or expired token");
			return { payload: session };
		},
		getUserInfo(payload) {
			if (config.getUserInfo) return config.getUserInfo(payload);
			const scopes = typeof payload.scopes === "string" ? payload.scopes.split(" ") : [];
			return {
				userId: payload.userId,
				roles: [],
				permissions: scopes,
				scopes: payload.scopes,
				clientId: payload.clientId
			};
		},
		getIssuer() {
			return authURL;
		},
		getAuthEndpoint() {
			return `${authURL}/mcp/authorize`;
		},
		getTokenEndpoint() {
			return `${authURL}/mcp/token`;
		},
		getScopesSupported() {
			return [
				"openid",
				"profile",
				"email",
				"offline_access"
			];
		},
		getGrantTypesSupported() {
			return ["authorization_code", "refresh_token"];
		},
		getMode() {
			return "direct";
		},
		getRegistrationEndpoint() {
			return `${authURL}/mcp/register`;
		}
	};
}
function normalizeURL(url) {
	if (!url || url.trim() === "") return void 0;
	return url.endsWith("/") ? url.slice(0, -1) : url;
}
//#endregion
export { mcpAuthHono, mcpAuthMcpUse, mcpAuthOfficial };

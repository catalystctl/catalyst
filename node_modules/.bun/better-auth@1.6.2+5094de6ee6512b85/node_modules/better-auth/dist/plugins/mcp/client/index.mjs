//#region src/plugins/mcp/client/index.ts
function buildCorsHeaders(authURL, allowedOrigin) {
	let origin;
	if (allowedOrigin) origin = allowedOrigin;
	else try {
		origin = new URL(authURL).origin;
	} catch {
		origin = authURL;
	}
	return {
		"Access-Control-Allow-Origin": origin,
		"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type, Authorization",
		"Access-Control-Max-Age": "86400"
	};
}
function makeWWWAuthenticate(authURL, resource) {
	return `Bearer resource_metadata="${resource ? `${resource}/.well-known/oauth-protected-resource` : `${authURL}/.well-known/oauth-protected-resource`}"`;
}
function make401Response(authURL, resource) {
	const wwwAuth = makeWWWAuthenticate(authURL, resource);
	return Response.json({
		jsonrpc: "2.0",
		error: {
			code: -32e3,
			message: "Unauthorized: Authentication required",
			"www-authenticate": wwwAuth
		},
		id: null
	}, {
		status: 401,
		headers: { "WWW-Authenticate": wwwAuth }
	});
}
function send401Node(res, wwwAuth, message) {
	const body = JSON.stringify({
		jsonrpc: "2.0",
		error: {
			code: -32e3,
			message
		},
		id: null
	});
	if (typeof res.set === "function") {
		res.set("WWW-Authenticate", wwwAuth);
		res.status?.(401).json(JSON.parse(body));
	} else if (typeof res.writeHead === "function") {
		res.writeHead(401, {
			"Content-Type": "application/json",
			"WWW-Authenticate": wwwAuth
		});
		res.end?.(body);
	}
}
function createMcpAuthClient(options) {
	const authURL = options.authURL.endsWith("/") ? options.authURL.slice(0, -1) : options.authURL;
	const fetchFn = options.fetch ?? globalThis.fetch;
	const corsHeaders = buildCorsHeaders(authURL, options.allowedOrigin);
	const verifyToken = async (token) => {
		try {
			const response = await fetchFn(`${authURL}/mcp/get-session`, {
				method: "GET",
				headers: { Authorization: `Bearer ${token}` }
			});
			if (!response.ok) return null;
			const data = await response.json();
			if (!data || !data.userId) return null;
			return data;
		} catch {
			return null;
		}
	};
	const handler = (fn) => {
		return async (req) => {
			if (req.method === "OPTIONS") return new Response(null, {
				status: 204,
				headers: corsHeaders
			});
			const authHeader = req.headers.get("Authorization");
			if (!authHeader || !authHeader.startsWith("Bearer ")) return make401Response(authURL, options.resource);
			const session = await verifyToken(authHeader.slice(7));
			if (!session) return make401Response(authURL, options.resource);
			return fn(req, session);
		};
	};
	const discoveryHandler = () => {
		let cachedMetadata = null;
		let cacheTime = 0;
		const CACHE_TTL = 6e4;
		return async (_req) => {
			const now = Date.now();
			if (cachedMetadata && now - cacheTime < CACHE_TTL) return Response.json(cachedMetadata, { headers: corsHeaders });
			try {
				const response = await fetchFn(`${authURL}/.well-known/oauth-authorization-server`);
				if (!response.ok) return Response.json({ error: "Failed to fetch discovery metadata" }, {
					status: 502,
					headers: corsHeaders
				});
				cachedMetadata = await response.json();
				cacheTime = now;
				return Response.json(cachedMetadata, { headers: corsHeaders });
			} catch {
				return Response.json({ error: "Better Auth server unreachable" }, {
					status: 502,
					headers: corsHeaders
				});
			}
		};
	};
	const protectedResourceHandler = (serverURL) => {
		const metadata = {
			resource: options.resource ?? new URL(serverURL).origin,
			authorization_servers: [authURL],
			bearer_methods_supported: ["header"],
			scopes_supported: [
				"openid",
				"profile",
				"email",
				"offline_access"
			]
		};
		return async (_req) => {
			return Response.json(metadata, { headers: corsHeaders });
		};
	};
	const middleware = () => {
		return async (req, res, next) => {
			const authHeader = req.headers?.authorization ?? req.headers?.get?.("Authorization") ?? req.get?.("Authorization");
			if (!authHeader || !authHeader.startsWith("Bearer ")) {
				send401Node(res, makeWWWAuthenticate(authURL, options.resource), "Unauthorized: Authentication required");
				return;
			}
			const session = await verifyToken(authHeader.slice(7));
			if (!session) {
				send401Node(res, makeWWWAuthenticate(authURL, options.resource), "Invalid or expired token");
				return;
			}
			req.mcpSession = session;
			next();
		};
	};
	return {
		verifyToken,
		handler,
		discoveryHandler,
		protectedResourceHandler,
		middleware,
		authURL
	};
}
//#endregion
export { createMcpAuthClient };

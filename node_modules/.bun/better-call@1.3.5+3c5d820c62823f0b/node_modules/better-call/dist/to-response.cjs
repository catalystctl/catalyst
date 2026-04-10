require('./error.cjs');
const require_utils = require('./utils.cjs');

//#region src/to-response.ts
function isJSONSerializable(value) {
	if (value === void 0) return false;
	const t = typeof value;
	if (t === "string" || t === "number" || t === "boolean" || t === null) return true;
	if (t !== "object") return false;
	if (Array.isArray(value)) return true;
	if (value.buffer) return false;
	return value.constructor && value.constructor.name === "Object" || typeof value.toJSON === "function";
}
function safeStringify(obj, replacer, space) {
	let id = 0;
	const seen = /* @__PURE__ */ new WeakMap();
	const safeReplacer = (key, value) => {
		if (typeof value === "bigint") return value.toString();
		if (typeof value === "object" && value !== null) {
			if (seen.has(value)) return `[Circular ref-${seen.get(value)}]`;
			seen.set(value, id++);
		}
		if (replacer) return replacer(key, value);
		return value;
	};
	return JSON.stringify(obj, safeReplacer, space);
}
function isJSONResponse(value) {
	if (!value || typeof value !== "object") return false;
	return "_flag" in value && value._flag === "json";
}
/**
* Headers that MUST be stripped when building an HTTP response from
* arbitrary header input. These are request-only, hop-by-hop, or
* transport-managed headers that cause protocol violations when present
* on responses (e.g. Content-Length mismatch → net::ERR_CONTENT_LENGTH_MISMATCH).
*
* Sources:
*   - RFC 9110 §10.1   (Request Context Fields)
*   - RFC 9110 §7.6.1  (Connection / hop-by-hop)
*   - RFC 9110 §11.6-7 (Authentication credentials)
*   - RFC 9110 §12.5   (Content negotiation)
*   - RFC 9110 §13.1   (Conditional request headers)
*   - RFC 9110 §14.2   (Range requests)
*   - RFC 6265 §5.4    (Cookie)
*   - RFC 6454         (Origin)
*/
const REQUEST_ONLY_HEADERS = new Set([
	"host",
	"user-agent",
	"referer",
	"from",
	"expect",
	"authorization",
	"proxy-authorization",
	"cookie",
	"origin",
	"accept-charset",
	"accept-encoding",
	"accept-language",
	"if-match",
	"if-none-match",
	"if-modified-since",
	"if-unmodified-since",
	"if-range",
	"range",
	"max-forwards",
	"connection",
	"keep-alive",
	"transfer-encoding",
	"te",
	"upgrade",
	"trailer",
	"proxy-connection",
	"content-length"
]);
function stripRequestOnlyHeaders(headers) {
	for (const name of REQUEST_ONLY_HEADERS) headers.delete(name);
}
function toResponse(data, init) {
	if (data instanceof Response) {
		if (init?.headers) {
			const safeHeaders = new Headers(init.headers);
			stripRequestOnlyHeaders(safeHeaders);
			safeHeaders.forEach((value, key) => {
				data.headers.set(key, value);
			});
		}
		return data;
	}
	if (isJSONResponse(data)) {
		const body = data.body;
		const routerResponse = data.routerResponse;
		if (routerResponse instanceof Response) return routerResponse;
		const headers = new Headers();
		if (routerResponse?.headers) {
			const headers = new Headers(routerResponse.headers);
			for (const [key, value] of headers.entries()) headers.set(key, value);
		}
		if (data.headers) for (const [key, value] of new Headers(data.headers).entries()) headers.set(key, value);
		if (init?.headers) {
			const safeHeaders = new Headers(init.headers);
			stripRequestOnlyHeaders(safeHeaders);
			for (const [key, value] of safeHeaders.entries()) headers.set(key, value);
		}
		headers.set("Content-Type", "application/json");
		return new Response(JSON.stringify(body), {
			...routerResponse,
			headers,
			status: data.status ?? init?.status ?? routerResponse?.status,
			statusText: init?.statusText ?? routerResponse?.statusText
		});
	}
	if (require_utils.isAPIError(data)) return toResponse(data.body, {
		status: init?.status ?? data.statusCode,
		statusText: data.status.toString(),
		headers: init?.headers || data.headers
	});
	let body = data;
	const headers = new Headers(init?.headers);
	stripRequestOnlyHeaders(headers);
	if (!data) {
		if (data === null) body = JSON.stringify(null);
		headers.set("content-type", "application/json");
	} else if (typeof data === "string") {
		body = data;
		headers.set("Content-Type", "text/plain");
	} else if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
		body = data;
		headers.set("Content-Type", "application/octet-stream");
	} else if (data instanceof Blob) {
		body = data;
		headers.set("Content-Type", data.type || "application/octet-stream");
	} else if (data instanceof FormData) body = data;
	else if (data instanceof URLSearchParams) {
		body = data;
		headers.set("Content-Type", "application/x-www-form-urlencoded");
	} else if (data instanceof ReadableStream) {
		body = data;
		headers.set("Content-Type", "application/octet-stream");
	} else if (isJSONSerializable(data)) {
		body = safeStringify(data);
		headers.set("Content-Type", "application/json");
	}
	return new Response(body, {
		...init,
		headers
	});
}

//#endregion
exports.toResponse = toResponse;
//# sourceMappingURL=to-response.cjs.map
import * as set_cookie_parser from "set-cookie-parser";

//#region src/adapters/node/request.ts
const getFirstHeaderValue = (header) => {
	if (Array.isArray(header)) return header[0];
	return header;
};
const hasFormUrlEncodedContentType = (headers) => {
	const contentType = getFirstHeaderValue(headers["content-type"]);
	if (!contentType) return false;
	return contentType.toLowerCase().startsWith("application/x-www-form-urlencoded");
};
const isPlainObject = (value) => {
	if (typeof value !== "object" || value === null) return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
};
const appendFormValue = (params, key, value) => {
	if (value === void 0) return;
	if (Array.isArray(value)) {
		for (const item of value) appendFormValue(params, key, item);
		return;
	}
	if (value === null) {
		params.append(key, "");
		return;
	}
	if (isPlainObject(value)) {
		params.append(key, JSON.stringify(value));
		return;
	}
	params.append(key, `${value}`);
};
const toFormUrlEncodedBody = (body) => {
	const params = new URLSearchParams();
	for (const [key, value] of Object.entries(body)) appendFormValue(params, key, value);
	return params.toString();
};
const canReadRawBody = (request) => {
	return !request.destroyed && request.readableEnded !== true && request.readable;
};
const serializeParsedBody = (parsedBody, isFormUrlEncoded) => {
	if (typeof parsedBody === "string") return parsedBody;
	if (parsedBody instanceof URLSearchParams) return parsedBody.toString();
	if (isFormUrlEncoded && isPlainObject(parsedBody)) return toFormUrlEncodedBody(parsedBody);
	return JSON.stringify(parsedBody);
};
function get_raw_body(req, body_size_limit) {
	const h = req.headers;
	if (!h["content-type"]) return null;
	const content_length = Number(h["content-length"]);
	if (req.httpVersionMajor === 1 && isNaN(content_length) && h["transfer-encoding"] == null || content_length === 0) return null;
	let length = content_length;
	if (body_size_limit) {
		if (!length) length = body_size_limit;
		else if (length > body_size_limit) throw Error(`Received content-length of ${length}, but only accept up to ${body_size_limit} bytes.`);
	}
	if (req.destroyed) {
		const readable = new ReadableStream();
		readable.cancel();
		return readable;
	}
	let size = 0;
	let cancelled = false;
	return new ReadableStream({
		start(controller) {
			req.on("error", (error) => {
				cancelled = true;
				controller.error(error);
			});
			req.on("end", () => {
				if (cancelled) return;
				controller.close();
			});
			req.on("data", (chunk) => {
				if (cancelled) return;
				size += chunk.length;
				if (size > length) {
					cancelled = true;
					controller.error(/* @__PURE__ */ new Error(`request body size exceeded ${content_length ? "'content-length'" : "BODY_SIZE_LIMIT"} of ${length}`));
					return;
				}
				controller.enqueue(chunk);
				if (controller.desiredSize === null || controller.desiredSize <= 0) req.pause();
			});
		},
		pull() {
			req.resume();
		},
		cancel(reason) {
			cancelled = true;
			req.destroy(reason);
		}
	});
}
function constructRelativeUrl(req) {
	const baseUrl = req.baseUrl;
	const originalUrl = req.originalUrl;
	if (!baseUrl || !originalUrl) return baseUrl ? baseUrl + req.url : req.url;
	if (baseUrl + req.url === originalUrl) return baseUrl + req.url;
	return originalUrl.split("?")[0].at(-1) === "/" ? baseUrl + req.url : baseUrl;
}
function getRequest({ request, base, bodySizeLimit }) {
	const maybeConsumedReq = request;
	const isFormUrlEncoded = hasFormUrlEncodedContentType(request.headers);
	let body = void 0;
	const method = request.method;
	if (method !== "GET" && method !== "HEAD") {
		if (canReadRawBody(request)) body = get_raw_body(request, bodySizeLimit);
		else if (maybeConsumedReq.body !== void 0) {
			const parsedBody = maybeConsumedReq.body;
			const bodyContent = serializeParsedBody(parsedBody, isFormUrlEncoded);
			body = new ReadableStream({ start(controller) {
				controller.enqueue(new TextEncoder().encode(bodyContent));
				controller.close();
			} });
		}
	}
	return new Request(base + constructRelativeUrl(request), {
		duplex: "half",
		method: request.method,
		body,
		headers: request.headers
	});
}
async function setResponse(res, response) {
	for (const [key, value] of response.headers) try {
		res.setHeader(key, key === "set-cookie" ? set_cookie_parser.splitCookiesString(response.headers.get(key)) : value);
	} catch (error) {
		res.getHeaderNames().forEach((name) => res.removeHeader(name));
		res.writeHead(500).end(String(error));
		return;
	}
	res.statusCode = response.status;
	res.writeHead(response.status);
	if (!response.body) {
		res.end();
		return;
	}
	if (response.body.locked) {
		res.end("Fatal error: Response body is locked. This can happen when the response was already read (for example through 'response.json()' or 'response.text()').");
		return;
	}
	const reader = response.body.getReader();
	if (res.destroyed) {
		reader.cancel();
		return;
	}
	const cancel = (error) => {
		res.off("close", cancel);
		res.off("error", cancel);
		reader.cancel(error).catch(() => {});
		if (error) res.destroy(error);
	};
	res.on("close", cancel);
	res.on("error", cancel);
	next();
	async function next() {
		try {
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				if (!res.write(value)) if (process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.LAMBDA_TASK_ROOT) continue;
				else {
					res.once("drain", next);
					return;
				}
				res.end();
			}
		} catch (error) {
			cancel(error instanceof Error ? error : new Error(String(error)));
		}
	}
}

//#endregion
export { getRequest, setResponse };
//# sourceMappingURL=request.mjs.map
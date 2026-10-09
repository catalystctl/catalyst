import type { FastifyRequest, FastifyReply } from "fastify";
import { randomUUID } from "crypto";

/**
 * Request ID middleware — generates a unique ID for each request and adds it
 * to the logger context for distributed tracing correlation.
 */
export async function requestIdMiddleware(
	request: FastifyRequest,
	_reply: FastifyReply,
): Promise<void> {
	// Generate UUID v4 for each request
	const requestId = randomUUID();
	
	// Fastify already assigns request.id, but we override it with our own UUID
	// to ensure it's always present and consistently formatted
	request.id = requestId;
	
	// Add request ID to the logger child context so all logs from this request
	// automatically include it
	request.log = request.log.child({ requestId });
}

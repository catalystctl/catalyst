import { Prisma } from "@prisma/client";
import type { FastifyReply } from "fastify";
import { CatalystError } from "../shared-types";
import type { ErrorCode } from "./error-codes/index.js";

export type MappedHttpError = {
	status: number;
	message: string;
	code: string;
	prismaCode?: string;
};

export interface ApiErrorExtras {
	/** Values for the localized message (thresholds, names, …). */
	params?: Record<string, unknown>;
	/** Field-level validation details. */
	details?: unknown;
}

/**
 * Send an error response with a stable, translatable error code.
 *
 * `message` stays English and is the fallback for clients that do not know the
 * code (or that speak a language the code has no translation for).
 */
export function apiError(
	reply: FastifyReply,
	status: number,
	code: ErrorCode,
	message: string,
	extras?: ApiErrorExtras,
): FastifyReply {
	return reply.status(status).send({
		error: message,
		code,
		...(extras?.params ? { params: extras.params } : {}),
		...(extras?.details ? { details: extras.details } : {}),
	});
}

const PRISMA_CODE_MAP: Record<
	string,
	{ status: number; message: string; code: string }
> = {
	P2000: { status: 400, message: "Invalid value", code: "VALIDATION_ERROR" },
	P2001: { status: 404, message: "Resource not found", code: "NOT_FOUND" },
	P2002: { status: 409, message: "Resource already exists", code: "CONFLICT" },
	P2003: { status: 400, message: "Related resource not found", code: "FOREIGN_KEY" },
	P2004: { status: 400, message: "Constraint failed", code: "CONSTRAINT_FAILED" },
	P2011: { status: 400, message: "Required value missing", code: "VALIDATION_ERROR" },
	P2014: { status: 400, message: "Invalid relation", code: "INVALID_RELATION" },
	P2025: { status: 404, message: "Resource not found", code: "NOT_FOUND" },
};

function isPrismaKnownRequestError(
	error: unknown,
): error is Prisma.PrismaClientKnownRequestError {
	if (error instanceof Prisma.PrismaClientKnownRequestError) {
		return true;
	}
	// Duck-type in case instanceof fails across hoisted Prisma copies.
	const err = error as { name?: string; code?: string } | null;
	return (
		!!err &&
		err.name === "PrismaClientKnownRequestError" &&
		typeof err.code === "string" &&
		err.code.startsWith("P")
	);
}

function sanitizeClientMessage(raw: string, fallback: string): string {
	if (!raw || raw.includes("\n") || raw.length > 200) {
		return fallback;
	}
	const looksInternal =
		raw.includes("prisma") ||
		raw.includes("Unique constraint") ||
		raw.includes("Foreign key") ||
		raw.includes("PrismaClient");
	return looksInternal ? fallback : raw;
}

/**
 * Map an unknown thrown value to a safe HTTP status, public message, and code.
 * Prisma KnownRequestError codes (P2002, P2025, …) become client-facing 4xx.
 */
export function mapHttpError(error: unknown): MappedHttpError {
	if (error instanceof CatalystError) {
		return {
			status: error.statusCode >= 400 ? error.statusCode : 500,
			message: error.message || "Internal Server Error",
			code: error.code || "INTERNAL_ERROR",
		};
	}

	if (isPrismaKnownRequestError(error)) {
		const mapped = PRISMA_CODE_MAP[error.code];
		if (mapped) {
			return { ...mapped, prismaCode: error.code };
		}
		return {
			status: 400,
			message: "Bad Request",
			code: "DATABASE_ERROR",
			prismaCode: error.code,
		};
	}

	const err = error as {
		statusCode?: number;
		code?: string;
		message?: string;
	} | null;
	const status =
		typeof err?.statusCode === "number" && err.statusCode >= 400
			? err.statusCode
			: 500;
	const rawCode = typeof err?.code === "string" ? err.code : undefined;
	const rawMessage = (error instanceof Error ? error.message : err?.message) || "";

	if (rawCode === "FST_ERR_VALIDATION") {
		return {
			status: 400,
			message: sanitizeClientMessage(rawMessage, "Invalid request"),
			code: "VALIDATION_ERROR",
		};
	}

	if (status === 429) {
		return {
			status: 429,
			message: sanitizeClientMessage(rawMessage, "Too many requests"),
			code: "RATE_LIMITED",
		};
	}

	if (status >= 500) {
		return {
			status,
			message: "Internal Server Error",
			code: rawCode && !rawCode.startsWith("P") ? rawCode : "INTERNAL_ERROR",
		};
	}

	if (
		rawMessage.includes("Unique constraint") ||
		rawCode === "P2002"
	) {
		return { status: 409, message: "Resource already exists", code: "CONFLICT" };
	}
	if (rawMessage.includes("Foreign key") || rawCode === "P2003") {
		return {
			status: 400,
			message: "Related resource not found",
			code: "FOREIGN_KEY",
		};
	}

	return {
		status,
		message: sanitizeClientMessage(
			rawMessage,
			status === 404 ? "Not Found" : "Bad Request",
		),
		code: rawCode && !rawCode.startsWith("P") ? rawCode : "BAD_REQUEST",
	};
}

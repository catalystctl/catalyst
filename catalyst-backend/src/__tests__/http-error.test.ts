import { describe, it, expect } from "vitest";
import { mapHttpError } from "../lib/http-error";
import { CatalystError, ErrorCodes } from "../shared-types";

describe("mapHttpError", () => {
	it("maps Prisma P2002 unique-constraint errors to 409 CONFLICT", () => {
		const err = {
			name: "PrismaClientKnownRequestError",
			code: "P2002",
			message: "Unique constraint failed on the fields: (`email`)",
		};
		expect(mapHttpError(err)).toEqual({
			status: 409,
			message: "Resource already exists",
			code: "CONFLICT",
			prismaCode: "P2002",
		});
	});

	it("maps Prisma P2025 record-not-found to 404", () => {
		const err = {
			name: "PrismaClientKnownRequestError",
			code: "P2025",
			message: "Record to update not found.",
		};
		expect(mapHttpError(err)).toMatchObject({
			status: 404,
			message: "Resource not found",
			code: "NOT_FOUND",
			prismaCode: "P2025",
		});
	});

	it("maps Prisma P2003 foreign-key errors to 400", () => {
		const err = {
			name: "PrismaClientKnownRequestError",
			code: "P2003",
			message: "Foreign key constraint failed",
		};
		expect(mapHttpError(err)).toMatchObject({
			status: 400,
			code: "FOREIGN_KEY",
			prismaCode: "P2003",
		});
	});

	it("preserves CatalystError code and status", () => {
		const err = new CatalystError(ErrorCodes.PERMISSION_DENIED, "Nope", 403);
		expect(mapHttpError(err)).toEqual({
			status: 403,
			message: "Nope",
			code: ErrorCodes.PERMISSION_DENIED,
		});
	});

	it("hides 5xx internals behind Internal Server Error", () => {
		expect(mapHttpError(new Error("prisma pool exploded"))).toEqual({
			status: 500,
			message: "Internal Server Error",
			code: "INTERNAL_ERROR",
		});
	});

	it("maps Fastify validation errors to 400 VALIDATION_ERROR", () => {
		const err = Object.assign(new Error("body/name must be string"), {
			code: "FST_ERR_VALIDATION",
			statusCode: 400,
		});
		expect(mapHttpError(err)).toMatchObject({
			status: 400,
			code: "VALIDATION_ERROR",
			message: "body/name must be string",
		});
	});

	it("maps 429 to RATE_LIMITED", () => {
		const err = Object.assign(new Error("Too many requests, please try again later."), {
			statusCode: 429,
		});
		expect(mapHttpError(err)).toMatchObject({
			status: 429,
			code: "RATE_LIMITED",
		});
	});

	it("sanitizes long or multiline 4xx messages", () => {
		const err = Object.assign(new Error("x".repeat(250)), { statusCode: 400 });
		expect(mapHttpError(err)).toMatchObject({
			status: 400,
			message: "Bad Request",
			code: "BAD_REQUEST",
		});
	});
});

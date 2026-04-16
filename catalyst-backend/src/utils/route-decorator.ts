/**
 * Route Decorator Utilities
 * 
 * Provides decorators for adding OpenAPI documentation to routes
 * while maintaining clean route handlers.
 */

import type { FastifySchema } from 'fastify';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

/**
 * Creates an OpenAPI-compatible schema from a Zod schema
 */
export function schema<T extends z.ZodSchema>(zodSchema: T) {
  return zodToJsonSchema(zodSchema, 'schema');
}

/**
 * Response schemas helper
 */
export function responses(schemas: Record<string, z.ZodSchema>) {
  const result: Record<string, any> = {};
  for (const [code, zodSchema] of Object.entries(schemas)) {
    result[code] = schema(zodSchema);
  }
  return result;
}

/**
 * Standard error response
 */
export const errorResponse = z.object({
  error: z.string(),
  details: z.array(z.object({
    field: z.string(),
    message: z.string(),
  })).optional(),
});

/**
 * Paginated response wrapper
 */
export function paginatedResponse<T extends z.ZodType>(dataSchema: T) {
  return z.object({
    success: z.boolean(),
    data: z.array(dataSchema),
    pagination: z.object({
      page: z.number(),
      pageSize: z.number(),
      total: z.number(),
      totalPages: z.number(),
    }),
  });
}

/**
 * Single item response wrapper
 */
export function itemResponse<T extends z.ZodType>(dataSchema: T) {
  return z.object({
    success: z.boolean(),
    data: dataSchema,
  });
}

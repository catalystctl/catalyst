/**
 * OpenAPI Schema Utilities
 * 
 * Helper functions for converting Zod schemas to JSON Schema for Fastify Swagger.
 * Handles Zod 4 compatibility with zod-to-json-schema.
 */

import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

// Type for the JSON Schema output
type JsonSchema = Record<string, unknown>;

/**
 * Convert a Zod schema to JSON Schema for Fastify Swagger
 * Uses type assertion to handle Zod 4 compatibility issues
 */
export function toJsonSchema<T extends z.ZodTypeAny>(schema: T, name?: string): JsonSchema {
  return zodToJsonSchema(schema, name) as JsonSchema;
}

// Alias for convenience
export const schema = toJsonSchema;

/**
 * Create an error response schema
 */
export function errorResponse(): JsonSchema {
  return {
    type: 'object',
    properties: {
      error: { type: 'string' },
      details: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            field: { type: 'string' },
            message: { type: 'string' },
          },
        },
      },
    },
  };
}

/**
 * Common parameter schemas
 */
export const params = {
  serverId: {
    type: 'object' as const,
    properties: {
      serverId: { type: 'string' as const, description: 'Server UUID' },
    },
    required: ['serverId'],
  },
  nodeId: {
    type: 'object' as const,
    properties: {
      nodeId: { type: 'string' as const, description: 'Node UUID' },
    },
    required: ['nodeId'],
  },
  userId: {
    type: 'object' as const,
    properties: {
      userId: { type: 'string' as const, description: 'User UUID' },
    },
    required: ['userId'],
  },
};

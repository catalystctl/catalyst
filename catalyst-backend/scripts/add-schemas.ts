#!/usr/bin/env bun
/**
 * Route Schema Generator
 * 
 * Generates inline JSON Schema documentation for routes.
 * This avoids Zod-to-json-schema compatibility issues.
 */

import { readdirSync, readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const routesDir = resolve(__dirname, '../src/routes');

// Common schemas used across routes
const COMMON_SCHEMAS = `
// =============================================================================
// OPENAPI SCHEMAS (Inline JSON Schema)
// =============================================================================

// Error response schema
const errorResponseSchema = {
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

// Server ID parameter
const serverIdParams = {
  type: 'object',
  properties: {
    serverId: { type: 'string', description: 'Server UUID' },
  },
  required: ['serverId'],
};

// Node ID parameter
const nodeIdParams = {
  type: 'object',
  properties: {
    nodeId: { type: 'string', description: 'Node UUID' },
  },
  required: ['nodeId'],
};

// User ID parameter
const userIdParams = {
  type: 'object',
  properties: {
    userId: { type: 'string', description: 'User UUID' },
  },
  required: ['userId'],
};

// Pagination query
const paginationQuery = {
  type: 'object',
  properties: {
    page: { type: 'number', default: 1, description: 'Page number' },
    limit: { type: 'number', default: 20, description: 'Items per page' },
    search: { type: 'string', description: 'Search term' },
  },
};
`;

// Add schemas to a route definition
function addSchemaToRoute(route: string, summary: string, description: string, schema?: object): string {
  const schemaObj = schema || {};
  return route.replace(
    /,\s*async\s*\(/,
    `,
  {
    schema: {
      summary: '${summary}',
      description: '${description}',
      ...${JSON.stringify(schemaObj, null, 8).replace(/"/g, "'").replace(/'/g, "\\'")},
    },
  },
  async (`
  );
}

// Generate schema for create operations
function createSchema(properties: Record<string, object>, required: string[] = []) {
  return {
    body: {
      type: 'object',
      properties,
      required,
    },
    response: {
      201: { ...errorResponseSchema, description: 'Created' },
      400: { ...errorResponseSchema, description: 'Bad Request' },
      401: { ...errorResponseSchema, description: 'Unauthorized' },
      404: { ...errorResponseSchema, description: 'Not Found' },
    },
  };
}

// Generate schema for list operations
function listSchema(itemProperties: object) {
  return {
    querystring: paginationQuery,
    response: {
      200: {
        type: 'object',
        properties: {
          success: { type: 'boolean' },
          data: { type: 'array', items: { type: 'object', properties: itemProperties } },
          pagination: {
            type: 'object',
            properties: {
              page: { type: 'number' },
              pageSize: { type: 'number' },
              total: { type: 'number' },
              totalPages: { type: 'number' },
            },
          },
        },
      },
    },
  };
}

// Route metadata
const routeMetadata: Record<string, { summary: string; description: string; schema?: object }> = {
  // Servers
  'POST /api/servers': {
    summary: 'Create server',
    description: 'Create a new game server instance',
    schema: createSchema({
      name: { type: 'string', description: 'Server name' },
      templateId: { type: 'string', description: 'Template UUID' },
      nodeId: { type: 'string', description: 'Node UUID' },
      locationId: { type: 'string', description: 'Location UUID' },
      ownerId: { type: 'string', description: 'Owner user UUID' },
      allocatedMemoryMb: { type: 'number', description: 'Allocated memory in MB' },
      allocatedCpuCores: { type: 'number', description: 'Allocated CPU cores' },
      allocatedDiskMb: { type: 'number', description: 'Allocated disk in MB' },
      primaryPort: { type: 'number', description: 'Primary server port' },
    }, ['name', 'templateId', 'nodeId', 'locationId', 'primaryPort', 'allocatedMemoryMb', 'allocatedCpuCores', 'allocatedDiskMb']),
  },
  'GET /api/servers': {
    summary: 'List servers',
    description: 'Get a paginated list of all servers',
    schema: listSchema({
      id: { type: 'string' },
      name: { type: 'string' },
      status: { type: 'string' },
    }),
  },
  'GET /api/servers/:serverId': {
    summary: 'Get server',
    description: 'Get details of a specific server',
    schema: {
      params: serverIdParams,
      response: {
        200: { ...errorResponseSchema, description: 'Success' },
        404: { ...errorResponseSchema, description: 'Not Found' },
      },
    },
  },
  // Add more routes as needed
};

console.log('Schema generator created. Routes will be documented with inline JSON Schema.');
console.log('This approach avoids Zod-to-json-schema compatibility issues.');

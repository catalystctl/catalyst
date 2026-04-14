/**
 * Catalyst - Input Validation Library
 *
 * Zod schemas for validating user input across the application.
 * Provides consistent validation and error messages.
 */

import { z } from 'zod';
import type { ZodIssue } from 'zod';

/**
 * Password complexity requirements
 * - Minimum 12 characters
 * - At least one uppercase letter
 * - At least one lowercase letter
 * - At least one number
 * - At least one special character
 */
export const passwordSchema = z.string()
  .min(12, 'Password must be at least 12 characters')
  .regex(/[A-Z]/, 'Must contain uppercase letter')
  .regex(/[a-z]/, 'Must contain lowercase letter')
  .regex(/[0-9]/, 'Must contain number')
  .regex(/[^A-Za-z0-9]/, 'Must contain special character');

/**
 * Basic password requirements (for backwards compatibility)
 * - Minimum 8 characters
 */
export const basicPasswordSchema = z.string()
  .min(8, 'Password must be at least 8 characters');

/**
 * Email validation
 */
export const emailSchema = z.string()
  .email('Invalid email address')
  .min(1, 'Email is required')
  .max(254, 'Email is too long')
  .transform(email => email.trim().toLowerCase());

/**
 * Username validation
 * - Alphanumeric, hyphens, underscores only
 * - 3-32 characters
 */
export const usernameSchema = z.string()
  .min(3, 'Username must be at least 3 characters')
  .max(32, 'Username must be at most 32 characters')
  .regex(/^[a-zA-Z0-9_-]+$/, 'Username can only contain letters, numbers, hyphens, and underscores');

/**
 * Server name validation
 * - 1-100 characters
 * - Alphanumeric, spaces, hyphens, underscores
 */
export const serverNameSchema = z.string()
  .min(1, 'Server name is required')
  .max(100, 'Server name must be at most 100 characters')
  .regex(/^[a-zA-Z0-9-_ ]+$/, 'Server name can only contain letters, numbers, spaces, hyphens, and underscores');

/**
 * Server creation validation
 */
export const serverCreateSchema = z.object({
  name: serverNameSchema,
  description: z.string().max(500).optional(),
  templateId: z.string().min(1, 'Template ID is required'),
  nodeId: z.string().min(1, 'Node ID is required'),
  locationId: z.string().min(1, 'Location ID is required'),
  ownerId: z.string().min(1, 'Owner ID is required'),
  environment: z.record(z.string(), z.string().min(1).max(4096)).optional().default({}),
  portBindings: z.record(z.string(), z.number().int().min(1).max(65535)).optional().default({}),
  primaryPort: z.number().int().min(1).max(65535),
  primaryIp: z.string().max(45).nullable().optional(),
  allocationId: z.string().min(1).optional(),
  allocatedMemoryMb: z.number().int().min(512).max(131072),
  allocatedCpuCores: z.number().int().min(1).max(128),
  allocatedDiskMb: z.number().int().min(1024).max(1048576),
  backupAllocationMb: z.number().int().min(0).max(1048576).optional(),
  databaseAllocation: z.number().int().min(0).max(1048576).optional(),
  networkMode: z.enum(['bridge', 'macvlan', 'host', 'mc-lan-static', 'mc-lan-dynamic']).default('mc-lan-static'),
});

/**
 * Server update validation
 */
export const serverUpdateSchema = z.object({
  name: serverNameSchema.optional(),
  description: z.string().max(500).optional(),
  environment: z.record(z.string(), z.string().min(1).max(4096)).optional(),
  portBindings: z.record(z.string(), z.number().int().min(1).max(65535)).optional(),
  allocatedMemoryMb: z.number().int().min(512).max(131072).optional(),
  allocatedCpuCores: z.number().int().min(1).max(128).optional(),
  allocatedDiskMb: z.number().int().min(1024).max(1048576).optional(),
  networkMode: z.enum(['bridge', 'macvlan', 'host']).optional(),
});

/**
 * File operation validation
 */
export const filePathSchema = z.string()
  .min(1, 'Path is required')
  .max(4096, 'Path is too long')
  .refine(path => !path.includes('..'), 'Path cannot contain ".."')
  .refine(path => !path.includes('\0'), 'Path cannot contain null bytes');

/**
 * File content validation
 */
export const fileContentSchema = z.string()
  .max(10 * 1024 * 1024, 'File content too large (max 10MB)');

/**
 * Backup name validation
 */
export const backupNameSchema = z.string()
  .min(1, 'Backup name is required')
  .max(255, 'Backup name must be at most 255 characters')
  .regex(/^[a-zA-Z0-9-_. ]+$/, 'Backup name can only contain letters, numbers, spaces, hyphens, underscores, and dots');

/**
 * API key name validation
 */
export const apiKeyNameSchema = z.string()
  .min(1, 'API key name is required')
  .max(100, 'API key name must be at most 100 characters');

/**
 * Permission validation
 */
export const permissionSchema = z.string()
  .regex(/^[a-z]+.[a-z]+$/, 'Permission must be in format "resource.action" (e.g., "server.read")');

/**
 * Role validation
 */
export const roleCreateSchema = z.object({
  name: z.string()
    .min(1, 'Role name is required')
    .max(100, 'Role name must be at most 100 characters')
    .regex(/^[a-zA-Z0-9-_]+$/, 'Role name can only contain letters, numbers, hyphens, and underscores'),
  description: z.string().max(500).optional(),
  permissions: z.array(permissionSchema).min(1, 'At least one permission is required'),
});

/**
 * User registration validation
 */
export const userRegistrationSchema = z.object({
  email: emailSchema,
  username: usernameSchema,
  password: passwordSchema, // Using complex password requirements
});

/**
 * User login validation
 */
export const userLoginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required'),
  rememberMe: z.boolean().optional().default(false),
});

/**
 * Password change validation
 */
export const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: passwordSchema,
  revokeOtherSessions: z.boolean().optional().default(false),
});

/**
 * Validation middleware factory
 * Creates a middleware that validates request body against a schema
 */
export const validateRequestBody = <T extends z.ZodSchema>(
  schema: T
) => {
  return async (request: any, reply: any) => {
    try {
      request.body = schema.parse(request.body);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: 'Invalid request body',
          details: formatZodIssues(error.issues),
        });
      }
      return reply.status(400).send({
        error: 'Invalid request body',
        details: (error instanceof Error ? error.message : String(error)),
      });
    }
  };
};

/**
 * Validation middleware for query parameters
 */
export const validateRequestQuery = <T extends z.ZodSchema>(
  schema: T
) => {
  return async (request: any, reply: any) => {
    try {
      request.query = schema.parse(request.query);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: 'Invalid request query',
          details: formatZodIssues(error.issues),
        });
      }
      return reply.status(400).send({
        error: 'Invalid request query',
        details: (error instanceof Error ? error.message : String(error)),
      });
    }
  };
};

/**
 * Validation middleware for route parameters
 */
export const validateRequestParams = <T extends z.ZodSchema>(
  schema: T
) => {
  return async (request: any, reply: any) => {
    try {
      request.params = schema.parse(request.params);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: 'Invalid request parameters',
          details: formatZodIssues(error.issues),
        });
      }
      return reply.status(400).send({
        error: 'Invalid request parameters',
        details: (error instanceof Error ? error.message : String(error)),
      });
    }
  };
};

/**
 * Sanitize user input to prevent XSS
 * Removes HTML tags and special characters
 */
/**
 * Format Zod v4 issues into a serializable array for API responses
 */
function formatZodIssues(issues: ZodIssue[]) {
  return issues.map(issue => ({
    field: issue.path.join('.'),
    message: issue.message,
  }));
}

/**
 * Sanitize user input to prevent XSS
 * Removes HTML tags and special characters
 */
export const sanitizeInput = (input: string): string => {
  // Strip all angle brackets in a single pass — no intermediate string can contain <script
  return input.replace(/[<>]/g, '').trim();
};

/**
 * Sanitize object values recursively
 */
export const sanitizeObject = <T extends Record<string, any>>(obj: T): T => {
  const sanitized: any = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      sanitized[key] = sanitizeInput(value);
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeObject(value);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
};

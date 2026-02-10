import { z } from 'zod';

/**
 * Zod schema for plugin manifest validation
 */
export const PluginManifestSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[a-z0-9-]+$/, 'Plugin name must be lowercase alphanumeric with hyphens'),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, 'Version must follow semver (e.g., 1.0.0)'),
  displayName: z.string().min(1).max(100),
  description: z.string().min(1).max(500),
  author: z.string().min(1).max(100),
  catalystVersion: z.string().min(1),
  permissions: z.array(z.string()).default([]),
  backend: z
    .object({
      entry: z.string(),
    })
    .optional(),
  frontend: z
    .object({
      entry: z.string(),
    })
    .optional(),
  dependencies: z.any().optional(), // Zod v4 has issues with z.record
  config: z.any().optional(), // Simplified for Zod v4 compatibility
});

/**
 * Validate plugin manifest
 */
export function validateManifest(data: unknown): z.infer<typeof PluginManifestSchema> {
  try {
    return PluginManifestSchema.parse(data);
  } catch (error) {
    console.error('Manifest validation error:', error);
    throw error;
  }
}

/**
 * Check if plugin has required permissions
 */
export function hasPermission(userPermissions: string[], requiredPermissions: string[]): boolean {
  if (userPermissions.includes('*')) return true;
  
  return requiredPermissions.every((required) => {
    // Check exact match
    if (userPermissions.includes(required)) return true;
    
    // Check wildcard permissions (e.g., 'server.*' matches 'server.start')
    const parts = required.split('.');
    for (let i = parts.length; i > 0; i--) {
      const wildcardPerm = `${parts.slice(0, i).join('.')}.*`;
      if (userPermissions.includes(wildcardPerm)) return true;
    }
    
    return false;
  });
}

/**
 * Validate Catalyst version compatibility
 */
export function isVersionCompatible(required: string, current: string): boolean {
  // Simple semver range check (supports >=, >, =, <, <=)
  const match = required.match(/^([><=]+)?\s*(\d+\.\d+\.\d+)$/);
  if (!match) return false;
  
  const operator = match[1] || '=';
  const requiredVersion = match[2];
  
  const compare = compareVersions(current, requiredVersion);
  
  switch (operator) {
    case '>=':
      return compare >= 0;
    case '>':
      return compare > 0;
    case '=':
    case '==':
      return compare === 0;
    case '<':
      return compare < 0;
    case '<=':
      return compare <= 0;
    default:
      return false;
  }
}

/**
 * Compare two semver versions
 * Returns: -1 if a < b, 0 if a === b, 1 if a > b
 */
function compareVersions(a: string, b: string): number {
  const aParts = a.split('.').map(Number);
  const bParts = b.split('.').map(Number);
  
  for (let i = 0; i < 3; i++) {
    if (aParts[i] > bParts[i]) return 1;
    if (aParts[i] < bParts[i]) return -1;
  }
  
  return 0;
}

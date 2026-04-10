/**
 * Catalyst - Network Isolation Utilities
 *
 * Network mode validation and security configurations for container networking.
 * Ensures proper network isolation based on the network mode selected.
 */

import { hasPermission } from './permissions';
import type { PrismaClient } from '@prisma/client';

/**
 * Network mode definitions with security levels
 */
export const networkModes = {
  bridge: {
    isolation: 'high',
    default: true,
    description: 'NAT isolation with private subnet - Recommended for most servers',
    warning: null,
    requiresApproval: false,
    allowedPermissions: ['server.create', 'server.update', '*'] as const,
  },
  macvlan: {
    isolation: 'low',
    default: false,
    description: 'Direct L2 network access - Exposes server on local network',
    warning: 'Direct L2 access - use only in trusted environments',
    requiresApproval: true,
    allowedPermissions: ['server.create', 'server.update', 'network.macvlan', '*'] as const,
  },
  host: {
    isolation: 'none',
    default: false,
    description: 'No network isolation - Uses host network namespace',
    warning: 'No network isolation - not recommended for production',
    requiresApproval: true,
    allowedPermissions: ['server.create', 'server.update', 'network.host', '*'] as const,
  },
} as const;

export type NetworkMode = keyof typeof networkModes;

/**
 * Validate if a network mode is allowed for the user
 */
export async function validateNetworkMode(
  prisma: PrismaClient,
  userId: string,
  networkMode: string,
  serverName?: string
): Promise<{ valid: boolean; error?: string; warning?: string }> {
  // Check if network mode is valid
  if (!(networkMode in networkModes)) {
    return {
      valid: false,
      error: `Invalid network mode: ${networkMode}. Valid modes: ${Object.keys(networkModes).join(', ')}`,
    };
  }

  const modeConfig = networkModes[networkMode as NetworkMode];

  // Check if user has required permissions
  const hasRequiredPermission = await hasAnyPermission(
    prisma,
    userId,
    modeConfig.allowedPermissions
  );

  if (!hasRequiredPermission) {
    return {
      valid: false,
      error: `Network mode '${networkMode}' requires elevated permissions`,
    };
  }

  // Check if approval is required
  if (modeConfig.requiresApproval) {
    return {
      valid: true,
      warning: `⚠️ ${modeConfig.warning}\n\nNetwork mode '${networkMode}' requires explicit approval for production use.`,
    };
  }

  return {
    valid: true,
    warning: modeConfig.warning || undefined,
  };
}

/**
 * Check if user has any of the required permissions
 */
async function hasAnyPermission(
  prisma: PrismaClient,
  userId: string,
  permissions: readonly string[]
): Promise<boolean> {
  for (const permission of permissions) {
    if (await hasPermission(prisma, userId, permission)) {
      return true;
    }
  }
  return false;
}

/**
 * Get network mode recommendations based on server type
 */
export function getNetworkModeRecommendation(serverType: string): NetworkMode {
  // Default to bridge for all server types
  return 'bridge';
}

/**
 * Get network isolation level for a mode
 */
export function getNetworkIsolationLevel(networkMode: string): string {
  return networkModes[networkMode as NetworkMode]?.isolation || 'unknown';
}

/**
 * Get security warnings for a network mode
 */
export function getNetworkSecurityWarning(networkMode: string): string | null {
  return networkModes[networkMode as NetworkMode]?.warning || null;
}

/**
 * Validate network port bindings
 */
export function validatePortBindings(
  portBindings: Record<string, number>,
  networkMode: string
): { valid: boolean; error?: string } {
  // Validate port ranges
  for (const [containerPort, hostPort] of Object.entries(portBindings)) {
    const container = parseInt(containerPort, 10);
    const host = parseInt(hostPort.toString(), 10);

    if (isNaN(container) || isNaN(host)) {
      return {
        valid: false,
        error: 'Invalid port number',
      };
    }

    if (container < 1 || container > 65535 || host < 1 || host > 65535) {
      return {
        valid: false,
        error: 'Port must be between 1 and 65535',
      };
    }

    // Warn about privileged ports (< 1024) for non-bridge modes
    if (networkMode !== 'bridge' && host < 1024) {
      return {
        valid: false,
        error: `Privileged ports (< 1024) are not allowed with ${networkMode} network mode`,
      };
    }
  }

  return { valid: true };
}

/**
 * Get network mode configuration
 */
export function getNetworkModeConfig(networkMode: string) {
  return networkModes[networkMode as NetworkMode];
}

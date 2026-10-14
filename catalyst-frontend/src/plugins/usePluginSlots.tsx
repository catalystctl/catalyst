// src/plugins/usePluginSlots.tsx
// Component slot system that allows plugins to inject components into
// designated areas of the host application.

import { useMemo } from 'react';
import { usePluginStore } from './store';
import { useAuthStore } from '../stores/authStore';
import { hasAnyPermission } from '../components/auth/ProtectedRoute';

/**
 * How the host surface evaluates a plugin component's `requiredPermissions`.
 *
 * A slot's own permissions are declared by the plugin; only the surface knows
 * what the viewer actually holds there. On a server page that means the global
 * grant *or* a server-scoped one (owner, subuser row, scoped role); elsewhere
 * it is the global set.
 */
export interface PluginSlotPermissionCheck {
  /**
   * Returns true when the viewer may see a component requiring `permissions`.
   * Called only for components that declare requirements.
   */
  (permissions: string[]): boolean;
}

/**
 * Default check: the signed-in user's global permissions, `*` included.
 * Exported so a surface can OR it with its own scope-aware check.
 */
export function globalSlotPermissionCheck(permissions?: string[]): PluginSlotPermissionCheck {
  return (required: string[]) => hasAnyPermission(permissions, required);
}

/**
 * Hook that returns all React components registered for a given slot name,
 * sorted by their order property (lowest first) and filtered by permission.
 *
 * @param slot Slot name, e.g. `dashboard-widgets`.
 * @param hasPermission Optional surface-aware permission check. Defaults to the
 *   viewer's global permissions. Components that declare no
 *   `requiredPermissions` always pass.
 */
export function usePluginSlots(
  slot: string,
  hasPermission?: PluginSlotPermissionCheck,
): React.ComponentType<any>[] {
  const plugins = usePluginStore((state) => state.plugins);
  const userPermissions = useAuthStore((state) => state.user?.permissions);

  return useMemo(() => {
    const allowed = hasPermission ?? globalSlotPermissionCheck(userPermissions);
    return plugins
      .filter((p) => p.manifest.enabled)
      .flatMap((p) => p.components)
      .filter((c) => c.slot === slot)
      .filter((c) => !c.requiredPermissions?.length || allowed(c.requiredPermissions))
      .sort((a, b) => (a.order ?? 50) - (b.order ?? 50))
      .map((c) => c.component);
  }, [plugins, slot, hasPermission, userPermissions]);
}

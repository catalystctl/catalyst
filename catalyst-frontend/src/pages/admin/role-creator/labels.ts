import type { TFunction } from 'i18next';

/**
 * Literal-key label lookups for the role editor.
 *
 * The extractor only sees `t('literal')` calls, so group and preset ids are
 * mapped through switches here rather than interpolated into a key at runtime.
 * Same pattern as `permissionCategoryLabel` in RolesPage.
 */

/** Title of a permission group (resource layer). */
export function groupTitle(t: TFunction<'admin-access'>, id: string): string {
  switch (id) {
    case 'server-operations': return t('roles.permissionCategories.server');
    case 'files': return t('roles.permissionCategories.fileManagement');
    case 'console': return t('roles.permissionCategories.console');
    case 'backups': return t('roles.permissionCategories.backup');
    case 'databases': return t('roles.permissionCategories.database');
    case 'alerts': return t('roles.permissionCategories.alerts');
    case 'content': return t('roles.permissionCategories.serverContent');
    case 'fleet': return t('roles.creator.groups.fleet');
    case 'infrastructure': return t('roles.creator.groups.infrastructure');
    case 'access': return t('roles.creator.groups.access');
    case 'apikeys': return t('roles.creator.groups.apikeys');
    case 'system': return t('roles.creator.groups.system');
    default: return t('roles.creator.groups.other');
  }
}

/** Title of a locally-defined quick-fill preset. */
export function fillLabel(t: TFunction<'admin-access'>, id: string): string {
  switch (id) {
    case 'viewer': return t('roles.creator.presets.viewer');
    case 'operator': return t('roles.creator.presets.operator');
    case 'manager': return t('roles.creator.presets.manager');
    default: return id;
  }
}

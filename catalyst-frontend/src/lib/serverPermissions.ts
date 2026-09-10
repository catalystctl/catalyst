/**
 * Shared server-scoped permission list — the "subuser permission" set.
 *
 * The canonical source is the backend (`ALL_SERVER_PERMISSIONS` in
 * catalyst-backend/src/lib/permissions-catalog.ts), served via
 * GET /api/permissions/server. The static list below is a fallback so the
 * UI renders even if the API is unreachable, and doubles as documentation.
 *
 * Consumers (they all render the SAME list, so new backend permissions
 * appear everywhere automatically):
 *   - Subuser invite/access editing (ServerDetailsPage → ServerUsersTab)
 *   - Role wizard "Scoped Access" step (RolesPage)
 */
import { useQuery } from '@/csync';
import apiClient from '../services/api/client';
import i18n from '@/i18n';

type ApiResponse<T> = {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
};

export const FALLBACK_SERVER_PERMISSIONS: string[] = [
  'server.read',
  'server.start',
  'server.stop',
  'server.install',
  'server.reinstall',
  'server.rebuild',
  'server.transfer',
  'server.delete',
  'server.schedule',
  'console.read',
  'console.write',
  'file.read',
  'file.write',
  'backup.read',
  'backup.create',
  'backup.restore',
  'backup.delete',
  'database.read',
  'database.create',
  'database.rotate',
  'database.delete',
  'alert.read',
  'alert.create',
  'alert.update',
  'alert.delete',
];

/**
 * Localized label for a server permission. A switch keeps every translation
 * key a literal in the source (see `serverStatusLabel` in utils/constants.ts),
 * and unknown permissions (plugin-provided) render as their identifier.
 */
export function serverPermissionLabel(perm: string): string {
  switch (perm) {
    case 'server.read':
      return i18n.t('serverPermissions.read', { ns: 'common' });
    case 'server.start':
      return i18n.t('serverPermissions.start', { ns: 'common' });
    case 'server.stop':
      return i18n.t('serverPermissions.stop', { ns: 'common' });
    case 'server.install':
      return i18n.t('serverPermissions.install', { ns: 'common' });
    case 'server.reinstall':
      return i18n.t('serverPermissions.reinstall', { ns: 'common' });
    case 'server.rebuild':
      return i18n.t('serverPermissions.rebuild', { ns: 'common' });
    case 'server.transfer':
      return i18n.t('serverPermissions.transfer', { ns: 'common' });
    case 'server.delete':
      return i18n.t('serverPermissions.delete', { ns: 'common' });
    case 'server.schedule':
      return i18n.t('serverPermissions.schedule', { ns: 'common' });
    case 'console.read':
      return i18n.t('serverPermissions.consoleRead', { ns: 'common' });
    case 'console.write':
      return i18n.t('serverPermissions.consoleWrite', { ns: 'common' });
    case 'file.read':
      return i18n.t('serverPermissions.fileRead', { ns: 'common' });
    case 'file.write':
      return i18n.t('serverPermissions.fileWrite', { ns: 'common' });
    case 'backup.read':
      return i18n.t('serverPermissions.backupRead', { ns: 'common' });
    case 'backup.create':
      return i18n.t('serverPermissions.backupCreate', { ns: 'common' });
    case 'backup.restore':
      return i18n.t('serverPermissions.backupRestore', { ns: 'common' });
    case 'backup.delete':
      return i18n.t('serverPermissions.backupDelete', { ns: 'common' });
    case 'database.read':
      return i18n.t('serverPermissions.databaseRead', { ns: 'common' });
    case 'database.create':
      return i18n.t('serverPermissions.databaseCreate', { ns: 'common' });
    case 'database.rotate':
      return i18n.t('serverPermissions.databaseRotate', { ns: 'common' });
    case 'database.delete':
      return i18n.t('serverPermissions.databaseDelete', { ns: 'common' });
    case 'alert.read':
      return i18n.t('serverPermissions.alertRead', { ns: 'common' });
    case 'alert.create':
      return i18n.t('serverPermissions.alertCreate', { ns: 'common' });
    case 'alert.update':
      return i18n.t('serverPermissions.alertUpdate', { ns: 'common' });
    case 'alert.delete':
      return i18n.t('serverPermissions.alertDelete', { ns: 'common' });
    default:
      return perm;
  }
}

/**
 * The shared server permission options, resolved from the backend with a
 * static fallback. `staleTime: Infinity` — the list only changes on deploy.
 */
export function useServerPermissionOptions() {
  return useQuery({
    queryKey: ['server-permissions'],
    queryFn: async (): Promise<string[]> => {
      try {
        const data = await apiClient.get<ApiResponse<string[]>>(
          '/api/permissions/server'
        );
        return Array.isArray(data.data) && data.data.length > 0
          ? data.data
          : FALLBACK_SERVER_PERMISSIONS;
      } catch {
        return FALLBACK_SERVER_PERMISSIONS;
      }
    },
    staleTime: Infinity,
    gcTime: Infinity,
    retry: 1,
  });
}

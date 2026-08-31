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

export const SERVER_PERMISSION_LABELS: Record<string, string> = {
  'server.read': 'View server details',
  'server.start': 'Start server',
  'server.stop': 'Stop / kill server',
  'server.install': 'Install server',
  'server.reinstall': 'Reinstall server',
  'server.rebuild': 'Rebuild server & variables',
  'server.transfer': 'Transfer server',
  'server.delete': 'Delete server',
  'server.schedule': 'Manage schedules & tasks',
  'console.read': 'View console',
  'console.write': 'Send console commands',
  'file.read': 'Browse files',
  'file.write': 'Edit & upload files',
  'backup.read': 'View backups',
  'backup.create': 'Create backups',
  'backup.restore': 'Restore backups',
  'backup.delete': 'Delete backups',
  'database.read': 'View databases',
  'database.create': 'Create databases',
  'database.rotate': 'Rotate database passwords',
  'database.delete': 'Delete databases',
  'alert.read': 'View alerts',
  'alert.create': 'Create alerts',
  'alert.update': 'Update alerts',
  'alert.delete': 'Delete alerts',
};

export function serverPermissionLabel(perm: string): string {
  return SERVER_PERMISSION_LABELS[perm] ?? perm;
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

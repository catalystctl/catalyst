import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import LoadingSpinner from '../shared/LoadingSpinner';

// Admin-panel permissions only. Ordinary server operator perms
// (server.read/start/stop) must NOT grant /admin access.
const ADMIN_PERMISSIONS = [
  'admin.read',
  'admin.write',
  'user.read',
  'user.create',
  'user.update',
  'user.delete',
  'user.ban',
  'user.unban',
  'user.set_roles',
  'role.read',
  'role.create',
  'role.update',
  'role.delete',
  'node.read',
  'node.create',
  'node.update',
  'node.delete',
  'node.view_stats',
  'node.manage_allocation',
  'location.read',
  'location.create',
  'location.update',
  'location.delete',
  'template.read',
  'template.create',
  'template.update',
  'template.delete',
  // Server *admin* actions (not operator power controls)
  'server.create',
  'server.delete',
  'server.suspend',
  'server.transfer',
  'server.schedule',
  'backup.read',
  'backup.create',
  'backup.delete',
  'backup.restore',
  'alert.read',
  'alert.create',
  'alert.update',
  'alert.delete',
  'apikey.manage',
];

function permissionMatches(granted: string, required: string): boolean {
  if (granted === required || granted === '*') return true;
  // Scoped grants like "node.delete:node_123" satisfy base "node.delete"
  if (granted.startsWith(`${required}:`)) return true;
  return false;
}

function hasAnyAdminPermission(permissions?: string[]): boolean {
  if (!permissions) return false;
  if (permissions.includes('*')) return true;
  return ADMIN_PERMISSIONS.some((perm) =>
    permissions.some((granted) => permissionMatches(granted, perm)),
  );
}

function hasAnyPermission(permissions?: string[], required?: string[]): boolean {
  if (!required || required.length === 0) return false;
  if (!permissions) return false;
  if (permissions.includes('*')) return true;
  return required.some((perm) =>
    permissions.some((granted) => permissionMatches(granted, perm)),
  );
}

type Props = {
 children: ReactNode;
 requireAdmin?: boolean;
 requireAdminWrite?: boolean;
 requirePermissions?: string[];
 redirectTo?: string;
};

function ProtectedRoute({ children, requireAdmin, requireAdminWrite, requirePermissions, redirectTo }: Props) {
 const location = useLocation();
 const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
 const isReady = useAuthStore((s) => s.isReady);
 const user = useAuthStore((s) => s.user);
 const userPermissions = user?.permissions || [];

 const hasAdminAccess =
 userPermissions.includes('*') ||
 userPermissions.includes('admin.write') ||
 userPermissions.includes('admin.read') ||
 hasAnyAdminPermission(userPermissions);
 const hasAdminWrite =
 userPermissions.includes('*') || userPermissions.includes('admin.write');
 const hasRequiredAccess = requirePermissions
 ? hasAnyPermission(userPermissions, requirePermissions)
 : hasAdminAccess;

 if (!isReady) {
 return <LoadingSpinner />;
 }

 if (!isAuthenticated) {
 return <Navigate to="/login" state={{ from: location }} replace />;
 }

 if (requireAdminWrite && !hasAdminWrite) {
 return <Navigate to={redirectTo ?? '/dashboard'} replace />;
 }

 if (requirePermissions && !hasRequiredAccess) {
 return <Navigate to={redirectTo ?? '/dashboard'} replace />;
 }

 if (requireAdmin && !hasAdminAccess) {
 return <Navigate to={redirectTo ?? '/dashboard'} replace />;
 }

 return children;
}

export default ProtectedRoute;
export { ADMIN_PERMISSIONS, hasAnyAdminPermission, hasAnyPermission };

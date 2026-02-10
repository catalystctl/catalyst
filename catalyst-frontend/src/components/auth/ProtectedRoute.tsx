import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import LoadingSpinner from '../shared/LoadingSpinner';

// All admin-related permissions that grant access to /admin routes
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
  'server.read',
  'server.create',
  'server.start',
  'server.stop',
  'server.delete',
  'server.suspend',
  'server.transfer',
  'server.schedule',
  'apikey.manage',
];

function hasAnyAdminPermission(permissions?: string[]): boolean {
  if (!permissions) return false;
  if (permissions.includes('*')) return true;
  return ADMIN_PERMISSIONS.some((perm) => permissions.includes(perm));
}

function hasAnyPermission(permissions?: string[], required?: string[]): boolean {
  if (!required || required.length === 0) return true;
  if (!permissions) return false;
  if (permissions.includes('*')) return true;
  return required.some((perm) => permissions.includes(perm));
}

type Props = {
  children: ReactNode;
  requireAdmin?: boolean;
  requireAdminWrite?: boolean;
  requirePermissions?: string[];
};

function ProtectedRoute({ children, requireAdmin, requireAdminWrite, requirePermissions }: Props) {
  const location = useLocation();
  const { isAuthenticated, isReady, user } = useAuthStore();
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
    return <Navigate to="/dashboard" replace />;
  }

  if (requirePermissions && !hasRequiredAccess) {
    return <Navigate to="/dashboard" replace />;
  }

  if (requireAdmin && !hasAdminAccess) {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
}

export default ProtectedRoute;
export { ADMIN_PERMISSIONS, hasAnyAdminPermission, hasAnyPermission };

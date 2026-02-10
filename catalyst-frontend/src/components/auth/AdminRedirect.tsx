import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { ADMIN_PERMISSIONS } from './ProtectedRoute';

// Map of routes to their required permissions
const ADMIN_ROUTES: Array<{ path: string; permissions: string[] }> = [
  { path: '/admin/users', permissions: ['user.read', 'user.create', 'user.update', 'user.delete', 'user.set_roles', 'admin.read', 'admin.write'] },
  { path: '/admin/roles', permissions: ['role.read', 'role.create', 'role.update', 'role.delete', 'admin.read', 'admin.write'] },
  { path: '/admin/servers', permissions: ['server.read', 'server.create', 'server.delete', 'admin.read', 'admin.write'] },
  { path: '/admin/nodes', permissions: ['node.read', 'node.create', 'node.update', 'node.delete', 'admin.read', 'admin.write'] },
  { path: '/admin/templates', permissions: ['template.read', 'template.create', 'template.update', 'template.delete', 'admin.read', 'admin.write'] },
  { path: '/admin/alerts', permissions: ['alert.read', 'alert.create', 'alert.update', 'alert.delete', 'admin.read', 'admin.write'] },
  { path: '/admin/database', permissions: ['admin.read', 'admin.write'] },
  { path: '/admin/network', permissions: ['admin.read', 'admin.write'] },
  { path: '/admin/api-keys', permissions: ['apikey.manage', 'admin.read', 'admin.write'] },
  { path: '/admin/system', permissions: ['admin.write'] },
  { path: '/admin/security', permissions: ['admin.read', 'admin.write'] },
  { path: '/admin/audit-logs', permissions: ['admin.read', 'admin.write'] },
  { path: '/admin/plugins', permissions: ['admin.read', 'admin.write'] },
  { path: '/admin/theme-settings', permissions: ['admin.write'] },
];

function AdminRedirect() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const userPermissions = user?.permissions || [];

  useEffect(() => {
    // If user has admin.read or admin.write, go to admin dashboard
    if (userPermissions.includes('*') || userPermissions.includes('admin.write') || userPermissions.includes('admin.read')) {
      navigate('/admin', { replace: true });
      return;
    }

    // Otherwise, find the first accessible admin route
    for (const route of ADMIN_ROUTES) {
      if (userPermissions.includes('*')) {
        navigate(route.path, { replace: true });
        return;
      }
      for (const perm of route.permissions) {
        if (userPermissions.includes(perm)) {
          navigate(route.path, { replace: true });
          return;
        }
      }
    }

    // If no admin permissions, go to dashboard
    navigate('/dashboard', { replace: true });
  }, [navigate, userPermissions]);

  return null; // This component doesn't render anything
}

export default AdminRedirect;

import { Navigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';

// Map of routes to their required permissions
const ADMIN_ROUTES: Array<{ path: string; permissions: string[] }> = [
 { path: '/admin/users', permissions: ['user.read', 'user.create', 'user.update', 'user.delete', 'user.set_roles', 'admin.read', 'admin.write'] },
 { path: '/admin/roles', permissions: ['role.read', 'role.create', 'role.update', 'role.delete', 'admin.read', 'admin.write'] },
 { path: '/admin/servers', permissions: ['server.read', 'server.create', 'server.delete', 'admin.read', 'admin.write'] },
 { path: '/admin/nodes', permissions: ['node.read', 'node.create', 'node.update', 'node.delete', 'admin.read', 'admin.write'] },
 { path: '/admin/templates', permissions: ['template.read', 'template.create', 'template.update', 'template.delete', 'admin.read', 'admin.write'] },
 { path: '/admin/alerts', permissions: ['alert.read', 'alert.create', 'alert.update', 'alert.delete', 'admin.read', 'admin.write'] },
 { path: '/admin/database', permissions: ['admin.read', 'admin.write'] },
 { path: '/admin/audit-logs', permissions: ['admin.read', 'admin.write'] },
 { path: '/admin/api-keys', permissions: ['apikey.manage', 'admin.read', 'admin.write'] },
 { path: '/admin/system', permissions: ['admin.write'] },
 { path: '/admin/security', permissions: ['admin.read', 'admin.write'] },
 { path: '/admin/plugins', permissions: ['admin.read', 'admin.write'] },
 { path: '/admin/theme-settings', permissions: ['admin.write'] },
];

function AdminRedirect() {
 const user = useAuthStore((s) => s.user);
 const userPermissions = user?.permissions || [];

 // Compute the target route during render — using <Navigate> is the
 // declarative React Router pattern and avoids the set-state-in-effect
 // anti-pattern flagged by react-hooks.
 let target = '/dashboard';
 if (
 userPermissions.includes('*') ||
 userPermissions.includes('admin.write') ||
 userPermissions.includes('admin.read')
 ) {
 target = '/admin';
 } else {
 const match = ADMIN_ROUTES.find((route) =>
 route.permissions.some((perm) => userPermissions.includes(perm)),
 );
 if (match) target = match.path;
 }

 return <Navigate to={target} replace />;
}

export default AdminRedirect;

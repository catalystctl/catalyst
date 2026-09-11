import AlertsPage from '../alerts/AlertsPage';
import { useAuthStore } from '../../stores/authStore';

function AdminAlertsPage() {
 const user = useAuthStore((s) => s.user);
 // Global/node targets require backend admin rights ('*', 'admin.write',
 // or 'admin.read'); alert.*-only holders stay on server-scoped rules.
 const perms = user?.permissions ?? [];
 const showAdminTargets =
  perms.includes('*') || perms.includes('admin.write') || perms.includes('admin.read');
 return (
 <div className="space-y-4">
 <AlertsPage scope="all" showAdminTargets={showAdminTargets} />
 </div>
 );
}

export default AdminAlertsPage;

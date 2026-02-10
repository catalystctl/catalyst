import AlertsPage from '../alerts/AlertsPage';

function AdminAlertsPage() {
  return (
    <div className="space-y-4">
      <AlertsPage scope="all" showAdminTargets />
    </div>
  );
}

export default AdminAlertsPage;

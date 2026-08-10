import { useEffect } from 'react';
import { useParams, Navigate } from 'react-router-dom';
import { usePluginTabs } from '../plugins/hooks';
import { usePluginContext } from '../plugins/usePluginContext';
import PluginErrorBoundary from '../plugins/PluginErrorBoundary';
import { useAuthStore } from '../stores/authStore';
import { hasAnyPermission } from '../components/auth/ProtectedRoute';
import LoadingSpinner from '../components/shared/LoadingSpinner';

interface PluginTabPageProps {
  location: 'admin' | 'server';
  serverId?: string;
}

export default function PluginTabPage({ location, serverId }: PluginTabPageProps) {
  const { pluginTabId } = useParams<{ pluginTabId: string }>();
  const { reloadPlugins, initialized, loading } = usePluginContext();
  const pluginTabs = usePluginTabs(location);
  const userPermissions = useAuthStore((s) => s.user?.permissions);

  useEffect(() => {
    if (!initialized && !loading) {
      reloadPlugins();
    }
  }, [initialized, loading, reloadPlugins]);

  if (!initialized || loading) {
    return <LoadingSpinner />;
  }

  const tab = pluginTabs.find((t) => t.id === pluginTabId);

  if (!tab) {
    return (
      <div className="rounded-lg border border-border bg-card p-12 text-center">
        <h2 className="mb-2 text-xl font-semibold text-foreground">
          Plugin Tab Not Found
        </h2>
        <p className="text-muted-foreground">
          The requested plugin tab could not be found or is not enabled.
        </p>
      </div>
    );
  }

  if (
    tab.requiredPermissions &&
    tab.requiredPermissions.length > 0 &&
    !hasAnyPermission(userPermissions, tab.requiredPermissions)
  ) {
    return <Navigate to={location === 'admin' ? '/admin' : '/dashboard'} replace />;
  }

  const TabComponent = tab.component;

  // Extract plugin name from tab id (format: {pluginName}-{location})
  const pluginName = tab.id.replace(/-(admin|server)$/, '');

  return (
    <PluginErrorBoundary pluginName={pluginName}>
      <div className="flex min-h-0 flex-1 flex-col">
        <TabComponent serverId={serverId} />
      </div>
    </PluginErrorBoundary>
  );
}

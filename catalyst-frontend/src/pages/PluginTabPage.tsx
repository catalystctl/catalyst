import { useEffect } from 'react';
import { useParams, Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Puzzle } from 'lucide-react';
import { usePluginTabs } from '../plugins/hooks';
import { usePluginContext } from '../plugins/usePluginContext';
import PluginErrorBoundary from '../plugins/PluginErrorBoundary';
import { useAuthStore } from '../stores/authStore';
import { hasAnyPermission } from '../components/auth/ProtectedRoute';
import LoadingSpinner from '../components/shared/LoadingSpinner';
import { BracketLabel } from '../components/deck/primitives';

interface PluginTabPageProps {
  location: 'admin' | 'server';
  serverId?: string;
}
export default function PluginTabPage({ location, serverId }: PluginTabPageProps) {
  const { t } = useTranslation('plugins');
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
    return (
      <div className="deck-panel flex items-center justify-center">
        <LoadingSpinner />
      </div>
    );
  }

  const tab = pluginTabs.find((t) => t.id === pluginTabId);

  if (!tab) {
    return (
      <div className="deck-panel overflow-hidden">
        <div className="flex items-start gap-2.5 border-b border-border/50 bg-surface-1/40 px-3 py-2.5">
          <Puzzle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <BracketLabel>{t('tabNotFound.title')}</BracketLabel>
            <p className="type-meta mt-1">{t('tabNotFound.description')}</p>
          </div>
        </div>
        <div className="px-3 py-5 text-center">
          <p className="type-overline">{t('tabNotFound.unavailable')}</p>
        </div>
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

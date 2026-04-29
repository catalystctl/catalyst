import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { usePluginTabs } from '../plugins/hooks';
import { usePluginContext } from '../plugins/PluginProvider';
import PluginErrorBoundary from '../plugins/PluginErrorBoundary';

interface PluginTabPageProps {
  location: 'admin' | 'server';
  serverId?: string;
}

export default function PluginTabPage({ location, serverId }: PluginTabPageProps) {
  const { pluginTabId } = useParams<{ pluginTabId: string }>();
  const { reloadPlugins, initialized, loading } = usePluginContext();
  const pluginTabs = usePluginTabs(location);

  useEffect(() => {
    if (!initialized && !loading) {
      reloadPlugins();
    }
  }, [initialized, loading, reloadPlugins]);

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

  const TabComponent = tab.component;

  // Extract plugin name from tab id (format: {pluginName}-{location})
  const pluginName = tab.id.replace(/-(admin|server)$/, '');

  return (
    <PluginErrorBoundary pluginName={pluginName}>
      <TabComponent serverId={serverId} />
    </PluginErrorBoundary>
  );
}

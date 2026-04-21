import { useParams } from 'react-router-dom';
import { usePluginTabs } from '../plugins/hooks';

interface PluginTabPageProps {
  location: 'admin' | 'server';
  serverId?: string;
}

export default function PluginTabPage({ location, serverId }: PluginTabPageProps) {
  const { pluginTabId } = useParams<{ pluginTabId: string }>();
  const pluginTabs = usePluginTabs(location);
  
  const tab = pluginTabs.find((t) => t.id === pluginTabId);
  
  if (!tab) {
    return (
      <div className="bg-gray-800 rounded-lg p-12 text-center">
        <h2 className="text-xl font-semibold text-gray-300 mb-2">
          Plugin Tab Not Found
        </h2>
        <p className="text-gray-400">
          The requested plugin tab could not be found or is not enabled.
        </p>
      </div>
    );
  }
  
  const TabComponent = tab.component;
  return <TabComponent serverId={serverId} />;
}

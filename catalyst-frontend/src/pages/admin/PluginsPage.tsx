import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchPlugins, togglePlugin, reloadPlugin, fetchPluginDetails, updatePluginConfig } from '../../plugins/api';
import { toast } from 'sonner';
import * as Dialog from '@radix-ui/react-dialog';
import {
  Power,
  PowerOff,
  RefreshCw,
  Settings,
  AlertCircle,
  CheckCircle,
  XCircle,
  Loader2,
  Package,
  X,
} from 'lucide-react';
import { usePluginContext } from '../../plugins/PluginProvider';

interface PluginConfig {
  [key: string]: any;
}

function PluginSettingsModal({ 
  pluginName, 
  open, 
  onOpenChange 
}: { 
  pluginName: string; 
  open: boolean; 
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [config, setConfig] = useState<PluginConfig>({});
  
  const { data: pluginDetails, isLoading } = useQuery({
    queryKey: ['plugin', pluginName],
    queryFn: () => fetchPluginDetails(pluginName),
    enabled: open,
  });
  
  // Update config when plugin details load
  React.useEffect(() => {
    if (pluginDetails?.config) {
      setConfig(pluginDetails.config);
    }
  }, [pluginDetails]);
  
  const updateMutation = useMutation({
    mutationFn: (newConfig: PluginConfig) => updatePluginConfig(pluginName, newConfig),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['plugins'] });
      queryClient.invalidateQueries({ queryKey: ['plugin', pluginName] });
      toast.success('Plugin configuration updated');
      onOpenChange(false);
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to update configuration');
    },
  });
  
  const handleSave = () => {
    updateMutation.mutate(config);
  };
  
  const handleConfigChange = (key: string, value: any) => {
    setConfig((prev) => ({
      ...prev,
      [key]: value,
    }));
  };
  
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white dark:bg-surface-1 rounded-lg p-6 w-full max-w-md z-50 border border-border dark:border-border">
          <div className="flex items-center justify-between mb-4">
            <Dialog.Title className="text-xl font-semibold text-foreground dark:text-zinc-100">
              Plugin Settings
            </Dialog.Title>
            <Dialog.Close className="text-muted-foreground hover:text-foreground dark:hover:text-foreground">
              <X className="h-5 w-5" />
            </Dialog.Close>
          </div>
          
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              <div className="mb-4">
                <p className="text-sm text-muted-foreground dark:text-muted-foreground mb-4">
                  Configure settings for <span className="font-semibold text-foreground dark:text-white">{pluginDetails?.displayName}</span>
                </p>
                
                <div className="space-y-4">
                  {Object.keys(config).length === 0 ? (
                    <p className="text-sm text-muted-foreground dark:text-muted-foreground text-center py-4">
                      No configuration options available
                    </p>
                  ) : (
                    Object.entries(config).map(([key, value]) => {
                      // Plugin config schema format: { type, default, description }
                      const isSchema = value && typeof value === 'object' && 'type' in value;
                      const fieldType = isSchema ? value.type : typeof value;
                      const currentValue = isSchema ? value.default : value;
                      const description = isSchema ? value.description : '';
                      const displayKey = isSchema
                        ? key.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase())
                        : key;

                      return (
                        <div key={key}>
                          <label className="block text-sm font-medium text-foreground dark:text-zinc-300 mb-1">
                            {displayKey}
                          </label>
                          {description && (
                            <p className="text-xs text-muted-foreground dark:text-muted-foreground mb-1.5">
                              {description}
                            </p>
                          )}
                          {fieldType === 'boolean' ? (
                            <label className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={!!currentValue}
                                onChange={(e) =>
                                  handleConfigChange(key, isSchema
                                    ? { ...value, default: e.target.checked }
                                    : e.target.checked
                                  )
                                }
                                className="rounded border-border dark:border-zinc-600 bg-white dark:bg-surface-2 text-primary-500 focus:ring-primary-500"
                              />
                              <span className="text-sm text-muted-foreground dark:text-muted-foreground">
                                {currentValue ? 'Enabled' : 'Disabled'}
                              </span>
                            </label>
                          ) : fieldType === 'number' ? (
                            <input
                              type="number"
                              value={currentValue ?? ''}
                              onChange={(e) =>
                                handleConfigChange(key, isSchema
                                  ? { ...value, default: parseFloat(e.target.value) || 0 }
                                  : parseFloat(e.target.value) || 0
                                )
                              }
                              className="w-full px-3 py-2 bg-white dark:bg-surface-2 border border-border dark:border-zinc-600 rounded-lg text-foreground dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                            />
                          ) : (
                            <input
                              type="text"
                              value={String(currentValue ?? '')}
                              onChange={(e) =>
                                handleConfigChange(key, isSchema
                                  ? { ...value, default: e.target.value }
                                  : e.target.value
                                )
                              }
                              className="w-full px-3 py-2 bg-white dark:bg-surface-2 border border-border dark:border-zinc-600 rounded-lg text-foreground dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                            />
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
              
              <div className="flex items-center gap-2 justify-end">
                <Dialog.Close className="px-4 py-2 rounded-lg bg-surface-2 dark:bg-surface-2 hover:bg-surface-3 dark:hover:bg-surface-2 text-foreground dark:text-white transition-colors">
                  Cancel
                </Dialog.Close>
                <button
                  onClick={handleSave}
                  disabled={updateMutation.isPending}
                  className="px-4 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {updateMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                  Save Changes
                </button>
              </div>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export default function PluginsPage() {
  const queryClient = useQueryClient();
  const { reloadPlugins } = usePluginContext();
  const [processingPlugin, setProcessingPlugin] = useState<string | null>(null);
  const [settingsPlugin, setSettingsPlugin] = useState<string | null>(null);
  
  const { data: plugins, isLoading } = useQuery({
    queryKey: ['plugins'],
    queryFn: fetchPlugins,
  });
  
  const toggleMutation = useMutation({
    mutationFn: ({ name, enabled }: { name: string; enabled: boolean }) =>
      togglePlugin(name, enabled),
    onMutate: ({ name }) => {
      setProcessingPlugin(name);
    },
    onSuccess: (_, { enabled }) => {
      queryClient.invalidateQueries({ queryKey: ['plugins'] });
      reloadPlugins();
      toast.success(`Plugin ${enabled ? 'enabled' : 'disabled'} successfully`);
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to toggle plugin');
    },
    onSettled: () => {
      setProcessingPlugin(null);
    },
  });
  
  const reloadMutation = useMutation({
    mutationFn: (name: string) => reloadPlugin(name),
    onMutate: (name) => {
      setProcessingPlugin(name);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['plugins'] });
      reloadPlugins();
      toast.success('Plugin reloaded successfully');
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to reload plugin');
    },
    onSettled: () => {
      setProcessingPlugin(null);
    },
  });
  
  const getStatusIcon = (status: string, error?: string) => {
    if (error || status === 'error') {
      return <XCircle className="h-5 w-5 text-red-500" />;
    }
    if (status === 'enabled') {
      return <CheckCircle className="h-5 w-5 text-green-500" />;
    }
    if (status === 'loading') {
      return <Loader2 className="h-5 w-5 text-blue-500 animate-spin" />;
    }
    return <AlertCircle className="h-5 w-5 text-gray-400" />;
  };
  
  const getStatusText = (status: string) => {
    const statusMap: Record<string, string> = {
      enabled: 'Enabled',
      disabled: 'Disabled',
      loaded: 'Loaded',
      loading: 'Loading',
      error: 'Error',
      unloaded: 'Unloaded',
    };
    return statusMap[status] || status;
  };
  
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }
  
  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-border bg-white p-6 shadow-surface-light transition-all duration-300 hover:border-primary-500 dark:border-border dark:bg-surface-1/70 dark:shadow-surface-dark dark:hover:border-primary/30">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-foreground dark:text-zinc-100">Plugins</h1>
            <p className="text-sm text-muted-foreground dark:text-muted-foreground">
              Manage and configure installed plugins
            </p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2 text-xs text-muted-foreground dark:text-muted-foreground">
          <span className="rounded-full border border-border bg-surface-2 px-3 py-1 dark:border-border dark:bg-zinc-950/60">
            {plugins?.length ?? 0} plugin{plugins?.length === 1 ? '' : 's'} installed
          </span>
          <span className="rounded-full border border-border bg-surface-2 px-3 py-1 dark:border-border dark:bg-zinc-950/60">
            {plugins?.filter((p) => p.enabled).length ?? 0} enabled
          </span>
        </div>
      </div>
      
      {settingsPlugin && (
        <PluginSettingsModal
          pluginName={settingsPlugin}
          open={true}
          onOpenChange={(open) => !open && setSettingsPlugin(null)}
        />
      )}
      
      {!plugins || plugins.length === 0 ? (
        <div className="rounded-xl border border-border bg-white p-12 text-center shadow-surface-light dark:border-border dark:bg-surface-1/60 dark:shadow-surface-dark">
          <Package className="h-16 w-16 text-muted-foreground dark:text-muted-foreground mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-foreground dark:text-zinc-100 mb-2">
            No Plugins Installed
          </h2>
          <p className="text-muted-foreground dark:text-muted-foreground">
            Place plugins in the <code className="bg-surface-2 dark:bg-surface-2 px-2 py-1 rounded">catalyst-plugins/</code> directory to get started.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {plugins.map((plugin) => (
            <div
              key={plugin.name}
              className="rounded-xl border border-border bg-white p-6 shadow-surface-light transition-all duration-300 hover:border-primary-500 dark:border-border dark:bg-surface-1/60 dark:shadow-surface-dark dark:hover:border-primary/30"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="text-lg font-semibold text-foreground dark:text-zinc-100">{plugin.displayName}</h3>
                    {getStatusIcon(plugin.status, plugin.error)}
                  </div>
                  <p className="text-sm text-muted-foreground dark:text-muted-foreground">v{plugin.version}</p>
                </div>
              </div>
              
              <p className="text-sm text-muted-foreground dark:text-zinc-300 mb-4 line-clamp-2">
                {plugin.description}
              </p>
              
              <div className="flex items-center gap-2 text-xs text-muted-foreground dark:text-muted-foreground mb-4">
                <span>By {plugin.author}</span>
                <span>•</span>
                <span>{getStatusText(plugin.status)}</span>
              </div>
              
              {plugin.error && (
                <div className="bg-red-500/10 border border-red-500/20 rounded p-2 mb-4">
                  <p className="text-xs text-red-400">{plugin.error}</p>
                </div>
              )}
              
              <div className="flex items-center gap-2">
                <button
                  onClick={() =>
                    toggleMutation.mutate({
                      name: plugin.name,
                      enabled: !plugin.enabled,
                    })
                  }
                  disabled={
                    processingPlugin === plugin.name || plugin.status === 'error'
                  }
                  className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    plugin.enabled
                      ? 'bg-red-500/10 text-red-400 hover:bg-red-500/20'
                      : 'bg-green-500/10 text-green-400 hover:bg-green-500/20'
                  } disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  {processingPlugin === plugin.name ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : plugin.enabled ? (
                    <>
                      <PowerOff className="h-4 w-4" />
                      Disable
                    </>
                  ) : (
                    <>
                      <Power className="h-4 w-4" />
                      Enable
                    </>
                  )}
                </button>
                
                <button
                  onClick={() => reloadMutation.mutate(plugin.name)}
                  disabled={processingPlugin === plugin.name}
                  className="px-3 py-2 rounded-lg bg-surface-2 hover:bg-surface-3 dark:bg-surface-2 dark:hover:bg-surface-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Reload plugin"
                >
                  <RefreshCw className="h-4 w-4 text-foreground dark:text-zinc-300" />
                </button>
                
                <button
                  onClick={() => setSettingsPlugin(plugin.name)}
                  className="px-3 py-2 rounded-lg bg-surface-2 hover:bg-surface-3 dark:bg-surface-2 dark:hover:bg-surface-2 transition-colors"
                  title="Plugin settings"
                >
                  <Settings className="h-4 w-4 text-foreground dark:text-zinc-300" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

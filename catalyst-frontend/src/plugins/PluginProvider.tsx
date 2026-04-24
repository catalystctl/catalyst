import React, { createContext, useContext, useState } from 'react';
import { usePluginStore } from './store';
import { fetchPlugins } from './api';
import { loadPluginFrontend } from './loader';
import { reportSystemError } from '../services/api/systemErrors';
import type { LoadedPlugin } from './types';

interface PluginContextValue {
  plugins: LoadedPlugin[];
  loading: boolean;
  error: string | null;
  initialized: boolean;
  reloadPlugins: () => Promise<void>;
}

const PluginContext = createContext<PluginContextValue | null>(null);

export function PluginProvider({ children }: { children: React.ReactNode }) {
  const plugins = usePluginStore((s) => s.plugins);
  const loading = usePluginStore((s) => s.loading);
  const error = usePluginStore((s) => s.error);
  const setPlugins = usePluginStore((s) => s.setPlugins);
  const setLoading = usePluginStore((s) => s.setLoading);
  const setError = usePluginStore((s) => s.setError);
  const [initialized, setInitialized] = useState(false);

  const loadPlugins = async () => {
    setLoading(true);
    setError(null);

    try {
      const manifests = await fetchPlugins();

      // Load frontend for each enabled plugin
      const loadedPlugins: LoadedPlugin[] = await Promise.all(
        manifests.map(async (manifest) => {
          if (manifest.enabled && manifest.hasFrontend) {
            return await loadPluginFrontend(manifest);
          }
          return {
            manifest,
            routes: [],
            tabs: [],
            components: [],
          };
        })
      );

      setPlugins(loadedPlugins);
      setInitialized(true);
    } catch (err: unknown) {
      console.error('Failed to load plugins:', err);
      setError(err instanceof Error ? err.message : 'Failed to load plugins');
    } finally {
      setLoading(false);
    }
  };

  const value: PluginContextValue = React.useMemo(() => ({
    plugins,
    loading,
    error,
    initialized,
    reloadPlugins: loadPlugins,
  }), [plugins, loading, error, initialized]);
  
  return <PluginContext.Provider value={value}>{children}</PluginContext.Provider>;
}

export function usePluginContext() {
  const context = useContext(PluginContext);
  if (!context) {
    reportSystemError({ level: 'error', component: 'PluginProvider', message: 'usePluginContext must be used within PluginProvider', metadata: { context: 'usePluginContext invariant' } });
    throw new Error('usePluginContext must be used within PluginProvider');
  }
  return context;
}

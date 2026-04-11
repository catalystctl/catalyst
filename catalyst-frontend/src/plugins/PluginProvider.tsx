import React, { createContext, useContext, useEffect, useState } from 'react';
import { usePluginStore } from './store';
import { fetchPlugins } from './api';
import { loadPluginFrontend } from './loader';
import type { LoadedPlugin } from './types';

interface PluginContextValue {
  plugins: LoadedPlugin[];
  loading: boolean;
  error: string | null;
  reloadPlugins: () => Promise<void>;
}

const PluginContext = createContext<PluginContextValue | null>(null);

export function PluginProvider({ children }: { children: React.ReactNode }) {
  const { plugins, loading, error, setPlugins, setLoading, setError } = usePluginStore();
  const [initialized, setInitialized] = useState(false);
  
  const loadPlugins = async () => {
    if (loading && initialized) return; // Prevent concurrent loads
    
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
  
  useEffect(() => {
    if (!initialized) {
      loadPlugins();
    }
  }, [initialized]);
  
  const value: PluginContextValue = React.useMemo(() => ({
    plugins,
    loading,
    error,
    reloadPlugins: loadPlugins,
  }), [plugins, loading, error]);
  
  return <PluginContext.Provider value={value}>{children}</PluginContext.Provider>;
}

export function usePluginContext() {
  const context = useContext(PluginContext);
  if (!context) {
    throw new Error('usePluginContext must be used within PluginProvider');
  }
  return context;
}

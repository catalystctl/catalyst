import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { usePluginStore } from './store';
import { fetchPlugins } from './api';
import { loadPluginFrontend } from './loader';
import { useAuthStore } from '../stores/authStore';
import { reportSystemError } from '../services/api/systemErrors';
import { PluginContext, type PluginContextValue } from './PluginContext';
import type { LoadedPlugin } from './types';

export function PluginProvider({ children }: { children: React.ReactNode }) {
  const plugins = usePluginStore((s) => s.plugins);
  const loading = usePluginStore((s) => s.loading);
  const error = usePluginStore((s) => s.error);
  const setPlugins = usePluginStore((s) => s.setPlugins);
  const setLoading = usePluginStore((s) => s.setLoading);
  const setError = usePluginStore((s) => s.setError);
  const [initialized, setInitialized] = useState(false);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  const loadPlugins = useCallback(async () => {
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
        }),
      );

      setPlugins(loadedPlugins);
      setInitialized(true);
    } catch (err: unknown) {
      console.error('Failed to load plugins:', err);
      setError(err instanceof Error ? err.message : 'Failed to load plugins');
    } finally {
      setLoading(false);
    }
  }, [setLoading, setError, setPlugins, setInitialized]);

  useEffect(() => {
    if (initialized || !isAuthenticated) return;

    let active = true;
    (async () => {
      try {
        const manifests = await fetchPlugins();
        if (!active) return;
        setLoading(true);
        setError(null);

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
          }),
        );

        if (!active) return;
        setPlugins(loadedPlugins);
        setInitialized(true);
      } catch (err: unknown) {
        if (!active) return;
        console.error('Failed to load plugins:', err);
        setError(err instanceof Error ? err.message : 'Failed to load plugins');
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [initialized, isAuthenticated, setLoading, setError, setPlugins, setInitialized]);

  const value: PluginContextValue = useMemo(() => ({
    plugins,
    loading,
    error,
    initialized,
    reloadPlugins: loadPlugins,
  }), [plugins, loading, error, initialized, loadPlugins]);

  return <PluginContext.Provider value={value}>{children}</PluginContext.Provider>;
}

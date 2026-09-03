import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePluginStore } from './store';
import { fetchPlugins } from './api';
import { loadPluginFrontend, unmountPluginFrontend } from './loader';
import { useAuthStore } from '../stores/authStore';
import { PluginContext, type PluginContextValue } from './PluginContext';
import { createAdminEventsStream } from '../services/api/admin-events';
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
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadPlugins = useCallback(async (opts: { forceReload?: boolean } = {}) => {
    setLoading(true);
    setError(null);

    try {
      const manifests = await fetchPlugins();

      // Load frontend for each enabled plugin
      const loadedPlugins: LoadedPlugin[] = await Promise.all(
        manifests.map(async (manifest) => {
          if (manifest.enabled && manifest.hasFrontend) {
            return await loadPluginFrontend(manifest, { forceReload: opts.forceReload });
          }
          return {
            manifest,
            routes: [],
            tabs: [],
            components: [],
          };
        }),
      );

      // Run onUnmount of replaced modules so hot reloads clean up listeners.
      const previous = usePluginStore.getState().plugins;
      for (const prev of previous) {
        const next = loadedPlugins.find((p) => p.manifest.name === prev.manifest.name);
        if (!next || next.manifest.version !== prev.manifest.version || opts.forceReload) {
          try {
            unmountPluginFrontend(prev);
          } catch {
            /* isolate */
          }
        }
      }

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

  // Live hot reload: backend pushes plugin_updated on install/upgrade/reload/
  // enable/disable. Re-fetch manifests and swap frontend bundles in place so
  // an update takes effect without a page refresh or panel reboot.
  useEffect(() => {
    if (!initialized || !isAuthenticated) return;
    const disconnect = createAdminEventsStream((type) => {
      if (type !== 'plugin_updated') return;
      if (reloadTimer.current) clearTimeout(reloadTimer.current);
      reloadTimer.current = setTimeout(() => {
        loadPlugins({ forceReload: true }).catch(() => {});
      }, 500);
    }, () => {});
    return () => {
      disconnect();
      if (reloadTimer.current) clearTimeout(reloadTimer.current);
    };
  }, [initialized, isAuthenticated, loadPlugins]);

  const value: PluginContextValue = useMemo(() => ({
    plugins,
    loading,
    error,
    initialized,
    reloadPlugins: loadPlugins,
  }), [plugins, loading, error, initialized, loadPlugins]);

  return <PluginContext.Provider value={value}>{children}</PluginContext.Provider>;
}

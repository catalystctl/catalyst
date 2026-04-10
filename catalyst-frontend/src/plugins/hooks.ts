import { useMemo } from 'react';
import { usePluginStore } from './store';
import type { PluginTabConfig, PluginRouteConfig } from './types';

/**
 * Get all loaded plugins
 */
export function usePlugins() {
  return usePluginStore((state) => state.plugins);
}

/**
 * Get enabled plugins only
 */
export function useEnabledPlugins() {
  return usePluginStore((state) => state.getEnabledPlugins());
}

/**
 * Get a specific plugin
 */
export function usePlugin(name: string) {
  return usePluginStore((state) => state.getPlugin(name));
}

/**
 * Get all plugin routes
 */
export function usePluginRoutes(): PluginRouteConfig[] {
  const plugins = usePluginStore((state) => state.plugins);
  
  return useMemo(() => {
    return plugins
      .filter(p => p.manifest.enabled)
      .flatMap((p) => p.routes);
  }, [plugins]);
}

/**
 * Get plugin tabs for a specific location
 */
export function usePluginTabs(location: 'admin' | 'server'): PluginTabConfig[] {
  const plugins = usePluginStore((state) => state.plugins);
  
  return useMemo(() => {
    return plugins
      .filter(p => p.manifest.enabled)
      .flatMap((p) => p.tabs)
      .filter((t) => t.location === location)
      .sort((a, b) => (a.order || 0) - (b.order || 0));
  }, [plugins, location]);
}

/**
 * Get components for a specific slot
 */
export function usePluginComponents(slot: string) {
  const plugins = usePluginStore((state) => state.plugins);
  
  return useMemo(() => {
    const components = plugins
      .filter(p => p.manifest.enabled)
      .flatMap((p) => p.components)
      .filter((c) => c.slot === slot)
      .sort((a, b) => (a.order || 0) - (b.order || 0));
    
    return components.map((c) => c.component);
  }, [plugins, slot]);
}

/**
 * Plugin loading state
 */
export function usePluginLoading() {
  return usePluginStore((state) => ({
    loading: state.loading,
    error: state.error,
  }));
}

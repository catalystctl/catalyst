import { create } from 'zustand';
import type { LoadedPlugin } from './types';

interface PluginStore {
  plugins: LoadedPlugin[];
  loading: boolean;
  error: string | null;
  
  setPlugins: (plugins: LoadedPlugin[]) => void;
  addPlugin: (plugin: LoadedPlugin) => void;
  removePlugin: (name: string) => void;
  updatePlugin: (name: string, updates: Partial<LoadedPlugin>) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  
  getPlugin: (name: string) => LoadedPlugin | undefined;
  getPluginsByLocation: (location: 'admin' | 'server') => LoadedPlugin[];
  getEnabledPlugins: () => LoadedPlugin[];
}

export const usePluginStore = create<PluginStore>((set, get) => ({
  plugins: [],
  loading: false,
  error: null,
  
  setPlugins: (plugins) => set({ plugins }),
  
  addPlugin: (plugin) => set((state) => ({
    plugins: [...state.plugins, plugin],
  })),
  
  removePlugin: (name) => set((state) => ({
    plugins: state.plugins.filter((p) => p.manifest.name !== name),
  })),
  
  updatePlugin: (name, updates) => set((state) => ({
    plugins: state.plugins.map((p) =>
      p.manifest.name === name ? { ...p, ...updates } : p
    ),
  })),
  
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  
  getPlugin: (name) => get().plugins.find((p) => p.manifest.name === name),
  
  getPluginsByLocation: (location) =>
    get().plugins.filter((p) => p.tabs.some((t) => t.location === location)),
  
  getEnabledPlugins: () =>
    get().plugins.filter((p) => p.manifest.enabled),
}));

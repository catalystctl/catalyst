import { createContext } from 'react';
import type { LoadedPlugin } from './types';

export interface PluginContextValue {
  plugins: LoadedPlugin[];
  loading: boolean;
  error: string | null;
  initialized: boolean;
  reloadPlugins: () => Promise<void>;
}

export const PluginContext = createContext<PluginContextValue | null>(null);

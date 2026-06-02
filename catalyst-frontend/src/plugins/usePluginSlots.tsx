// src/plugins/usePluginSlots.tsx
// Component slot system that allows plugins to inject components into
// designated areas of the host application.

import { useMemo } from 'react';
import { usePluginStore } from './store';

/**
 * Hook that returns all React components registered for a given slot name,
 * sorted by their order property (lowest first).
 *
 * @example
 * const widgets = usePluginSlots('dashboard-widgets');
 * return widgets.map((Component, i) => <Component key={i} />);
 */
export function usePluginSlots(slot: string): React.ComponentType<any>[] {
  const plugins = usePluginStore((state) => state.plugins);

  return useMemo(() => {
    return plugins
      .filter((p) => p.manifest.enabled)
      .flatMap((p) => p.components)
      .filter((c) => c.slot === slot)
      .sort((a, b) => (a.order ?? 50) - (b.order ?? 50))
      .map((c) => c.component);
  }, [plugins, slot]);
}

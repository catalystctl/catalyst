// src/plugins/usePluginSlots.tsx
// Component slot system that allows plugins to inject components into
// designated areas of the host application.

import React, { useMemo } from 'react';
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

interface PluginSlotProps {
  /** The slot name to render components for */
  name: string;
  /** Rendered when no components are registered for this slot */
  fallback?: React.ReactNode;
  /** Additional props to pass to each rendered component */
  componentProps?: Record<string, any>;
  /** Wrapper element or component for the slot container */
  as?: React.ElementType;
  /** Class name for the wrapper element */
  className?: string;
}

/**
 * Renders all components registered for a given slot.
 *
 * @example
 * // In a dashboard layout:
 * <PluginSlot name="dashboard-widgets" fallback={<p>No widgets</p>} />
 *
 * // In a sidebar:
 * <PluginSlot name="sidebar-bottom" as="div" className="mt-auto border-t pt-4" />
 */
export function PluginSlot({
  name,
  fallback = null,
  componentProps,
  as: Wrapper = 'div',
  className,
}: PluginSlotProps) {
  const components = usePluginSlots(name);

  if (components.length === 0) {
    return <>{fallback}</>;
  }

  return (
    <Wrapper className={className}>
      {components.map((Component, index) => (
        <Component key={`${name}-${index}`} {...(componentProps ?? {})} />
      ))}
    </Wrapper>
  );
}

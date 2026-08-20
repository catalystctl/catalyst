// src/plugins/PluginSlot.tsx
// Component that renders all components registered for a given plugin slot.

import React from 'react';
import { usePluginSlots } from './usePluginSlots';
import PluginErrorBoundary from './PluginErrorBoundary';

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
        <PluginErrorBoundary
          key={`${name}-${index}`}
          pluginName={name}
          fallback={
            <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-muted-foreground">
              Plugin widget failed to render
            </div>
          }
        >
          <Component {...(componentProps ?? {})} />
        </PluginErrorBoundary>
      ))}
    </Wrapper>
  );
}

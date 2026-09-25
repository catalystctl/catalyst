import { Toaster } from 'sonner';
import type { CSSProperties } from 'react';
import { useUIStore } from '../../stores/uiStore';

/**
 * Sonner's stylesheet is unlayered, so Tailwind utility classes cannot win the
 * cascade. Drive its neutral surface through the custom properties it already
 * reads: `--border-radius` matches `rounded-md` (calc(var(--radius) - 2px)) and
 * the normal background/border/text come from the panel tokens. Rich colors
 * are left alone so success/error/warning toasts keep their semantic tone.
 */
const TOASTER_STYLE = {
  '--border-radius': 'calc(var(--radius) - 2px)',
  '--normal-bg': 'var(--sonner-background)',
  '--normal-border': 'var(--sonner-border)',
  '--normal-text': 'var(--sonner-text)',
  '--normal-bg-hover': 'hsl(var(--surface-2))',
  '--normal-border-hover': 'hsl(var(--border))',
} as CSSProperties;

export function ToastProvider() {
  const theme = useUIStore((s) => s.theme);
  return (
    <Toaster
      position="top-right"
      expand
      richColors
      closeButton
      duration={4000}
      theme={theme}
      style={TOASTER_STYLE}
    />
  );
}

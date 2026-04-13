import { useThemeStore } from '../stores/themeStore';

/**
 * Returns the current panel branding settings (name, logo, favicon)
 * from the server-side theme settings. Falls back to "Catalyst" defaults.
 */
export function usePanelBranding() {
  const themeSettings = useThemeStore((s) => s.themeSettings);
  const panelName = themeSettings?.panelName || 'Catalyst';
  const logoUrl = themeSettings?.logoUrl || '/logo.png';
  const faviconUrl = themeSettings?.faviconUrl || null;
  return { panelName, logoUrl, faviconUrl };
}

/**
 * ThemeSettingsPage — remount with cached query data.
 *
 * Regression: navigating Themes → Plugins → Themes unmounted and remounted the
 * page while the csync cache still held the theme settings (staleTime 10 min).
 * The remount received the SAME cached object reference, and because the
 * "initialize form from server" sync used `useState(settings)` as its previous
 * value tracker, `settings !== prevSettings` was false on the first render.
 * The form never hydrated and silently fell back to its useState defaults
 * (panel name "Catalyst", stock colors, empty branding fields, OIDC shown as
 * "Not configured") — a hard refresh wiped the cache and "brought them back".
 *
 * These tests simulate exactly that: the first mount fetches, the second mount
 * is served the cached reference. Saved values must appear on BOTH mounts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

const getThemeSettingsMock = vi.fn();
const getOidcConfigMock = vi.fn();

vi.mock('../../../services/api/admin', () => ({
  adminApi: {
    getThemeSettings: (...args: unknown[]) => getThemeSettingsMock(...args),
    updateThemeSettings: vi.fn(),
    getOidcConfig: (...args: unknown[]) => getOidcConfigMock(...args),
    updateOidcConfig: vi.fn(),
  },
}));

import { queryClient } from '../../../lib/queryClient';
import { QueryClientProvider } from '../../../csync';
import ThemeSettingsPage from '../ThemeSettingsPage';
import { defaultThemeColors } from '../../../stores/themeStore';

const SAVED_SETTINGS = {
  panelName: 'My Custom Panel',
  logoUrl: 'https://cdn.example.com/logo.png',
  faviconUrl: 'https://cdn.example.com/favicon.ico',
  defaultTheme: 'light',
  enabledThemes: ['light', 'dark'],
  primaryColor: '#112233',
  secondaryColor: '#445566',
  accentColor: '#778899',
  customCss: 'body { color: hotpink; }',
  metadata: {
    themeColors: { ...defaultThemeColors, borderRadius: '1rem' },
  },
};

const SAVED_OIDC = {
  paymenter: {
    clientId: 'pay-client',
    clientSecret: 'pay-secret',
    discoveryUrl: 'https://pay.example.com',
    source: 'database',
  },
};

function renderPage() {
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeSettingsPage />
    </QueryClientProvider>,
  );
}

/** The OIDC section lives on the Advanced tab. */
function openAdvancedTab() {
  fireEvent.click(screen.getByRole('button', { name: /Advanced/ }));
}

/** Brand fields live on the Brand tab (Presets is the landing tab). */
async function openBrandTab() {
  const btn = await screen.findByRole('button', { name: /Brand/ });
  fireEvent.click(btn);
}

describe('ThemeSettingsPage — remount with cached query data', () => {
  beforeEach(() => {
    queryClient.clear();
    getThemeSettingsMock.mockReset().mockResolvedValue(SAVED_SETTINGS);
    getOidcConfigMock.mockReset().mockResolvedValue(SAVED_OIDC);
  });

  afterEach(() => {
    cleanup();
    queryClient.clear();
  });

  it('hydrates the form from a fresh fetch on first mount', async () => {
    renderPage();

    await openBrandTab();
    expect(await screen.findByDisplayValue('My Custom Panel')).toBeInTheDocument();
    expect(screen.getByDisplayValue('https://cdn.example.com/logo.png')).toBeInTheDocument();
    // OIDC section (Advanced tab) hydrates too
    openAdvancedTab();
    expect(await screen.findByDisplayValue('pay-client')).toBeInTheDocument();
    expect(screen.getByDisplayValue('https://pay.example.com')).toBeInTheDocument();
  });

  it('still shows saved settings when remounting from cache (Themes → Plugins → Themes)', async () => {
    const first = renderPage();
    await openBrandTab();
    await screen.findByDisplayValue('My Custom Panel');
    first.unmount();

    // Second mount: the query is cached AND fresh (staleTime 10 min), so the
    // hook returns the exact same settings object reference it had before.
    renderPage();
    await openBrandTab();

    expect(await screen.findByDisplayValue('My Custom Panel')).toBeInTheDocument();
    expect(screen.getByDisplayValue('https://cdn.example.com/logo.png')).toBeInTheDocument();
    expect(screen.getByDisplayValue('https://cdn.example.com/favicon.ico')).toBeInTheDocument();
    // OIDC section (Advanced tab) must also hydrate from cache
    openAdvancedTab();
    expect(await screen.findByDisplayValue('pay-client')).toBeInTheDocument();

    // The regression specifically: fields must not fall back to defaults.
    expect(screen.queryByDisplayValue('Catalyst')).not.toBeInTheDocument();
  });
});

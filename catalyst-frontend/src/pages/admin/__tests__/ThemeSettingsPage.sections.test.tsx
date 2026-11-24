/**
 * ThemeSettingsPage — section anchors, hash scroll and the unsaved-changes guard.
 *
 * Two audit items share this page:
 *  - A9: SearchPalette ships ~20 settings rows that all land at scrollY 0
 *    because the page had no hash handling. Each section now carries a stable
 *    id and a hash opens its tab before scrolling to it.
 *  - Reset-all and tab switches used to throw live-preview edits away without a
 *    word; both now confirm first.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const getThemeSettingsMock = vi.fn();
const getOidcConfigMock = vi.fn();
const scrollIntoViewMock = vi.fn();

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

const SETTINGS = {
  panelName: 'Catalyst',
  logoUrl: '',
  faviconUrl: '',
  defaultTheme: 'dark',
  enabledThemes: ['light', 'dark'],
  primaryColor: '#c48d5a',
  secondaryColor: '#5ac4c2',
  accentColor: '#5a5cc4',
  customCss: '',
  metadata: { themeColors: { ...defaultThemeColors } },
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/admin/theme-settings']}>
      <QueryClientProvider client={queryClient}>
        <ThemeSettingsPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  queryClient.clear();
  getThemeSettingsMock.mockReset().mockResolvedValue(SETTINGS);
  getOidcConfigMock.mockReset().mockResolvedValue({});
  scrollIntoViewMock.mockClear();
  // jsdom does not implement scrollIntoView at all.
  Element.prototype.scrollIntoView = scrollIntoViewMock;
  window.location.hash = '';
});

afterEach(() => {
  cleanup();
  queryClient.clear();
  window.location.hash = '';
});

describe('ThemeSettingsPage — section anchors', () => {
  // The exact set SearchPalette deep-links to — a rename here silently breaks
  // every palette entry that names the old id.
  const SECTION_IDS = [
    'branding',
    'palette-generator',
    'brand-colors',
    'semantic-colors',
    'dark-surfaces',
    'light-surfaces',
    'theme-mode',
    'layout-radius',
    'custom-css',
    'sso',
  ];

  it('renders one element per deep-link id, each on its own tab', async () => {
    renderPage();
    await screen.findByRole('button', { name: /Presets/ });

    for (const id of SECTION_IDS) {
      window.location.hash = `#${id}`;
      fireEvent(window, new HashChangeEvent('hashchange'));
      await waitFor(() => expect(document.getElementById(id)).toBeInTheDocument());
    }
  });

  it('opens the owning tab and scrolls to the section named by the hash', async () => {
    window.location.hash = '#custom-css';
    renderPage();

    // custom-css lives on the Advanced tab: the tab has to switch for the
    // element to exist at all.
    await waitFor(() =>
      expect(document.getElementById('custom-css')).toBeInTheDocument(),
    );
    await waitFor(() => {
      const scrolled = scrollIntoViewMock.mock.instances as unknown as HTMLElement[];
      expect(scrolled.some((el) => el?.id === 'custom-css')).toBe(true);
    });
  });

  it('follows a later hashchange to a different section', async () => {
    renderPage();
    await screen.findByRole('button', { name: /Presets/ });

    window.location.hash = '#layout-radius';
    fireEvent(window, new HashChangeEvent('hashchange'));

    await waitFor(() =>
      expect(document.getElementById('layout-radius')).toBeInTheDocument(),
    );
    await waitFor(() => {
      const scrolled = scrollIntoViewMock.mock.instances as unknown as HTMLElement[];
      expect(scrolled.some((el) => el?.id === 'layout-radius')).toBe(true);
    });
  });

  it('ignores a hash that names no section', async () => {
    window.location.hash = '#not-a-section';
    renderPage();
    await screen.findByRole('button', { name: /Presets/ });
    expect(scrollIntoViewMock).not.toHaveBeenCalled();
  });
});

describe('ThemeSettingsPage — unsaved-changes guard', () => {
  it('asks before Reset all, and leaves the form alone when cancelled', async () => {
    renderPage();
    await screen.findByRole('button', { name: /Brand/ });
    fireEvent.click(screen.getByRole('button', { name: /Brand/ }));
    fireEvent.change(await screen.findByLabelText('Panel Name'), {
      target: { value: 'Renamed panel' },
    });

    fireEvent.click(screen.getByRole('button', { name: /Reset All/ }));
    // Confirm dialog appears; cancel keeps the edit.
    await screen.findByText('Reset all changes?');
    fireEvent.click(screen.getByRole('button', { name: /^Cancel$/ }));

    await waitFor(() =>
      expect(screen.queryByText('Reset all changes?')).not.toBeInTheDocument(),
    );
    expect(screen.getByDisplayValue('Renamed panel')).toBeInTheDocument();
  });

  it('resets the form once Reset all is confirmed', async () => {
    renderPage();
    await screen.findByRole('button', { name: /Brand/ });
    fireEvent.click(screen.getByRole('button', { name: /Brand/ }));
    fireEvent.change(await screen.findByLabelText('Panel Name'), {
      target: { value: 'Renamed panel' },
    });

    fireEvent.click(screen.getByRole('button', { name: /Reset All/ }));
    fireEvent.click(await screen.findByRole('button', { name: /^Reset all$/ }));

    await waitFor(() => expect(screen.queryByDisplayValue('Renamed panel')).not.toBeInTheDocument());
    expect(screen.getByDisplayValue('Catalyst')).toBeInTheDocument();
  });

  it('leaves the tab switch unguarded (one shared form, nothing is lost)', async () => {
    renderPage();
    await screen.findByRole('button', { name: /Brand/ });
    fireEvent.click(screen.getByRole('button', { name: /Brand/ }));
    fireEvent.change(await screen.findByLabelText('Panel Name'), {
      target: { value: 'Renamed panel' },
    });

    fireEvent.click(screen.getByRole('button', { name: /Colors/ }));
    expect(screen.queryByText('Discard unsaved theme changes?')).not.toBeInTheDocument();
    expect(document.getElementById('brand-colors')).toBeInTheDocument();
  });

  it('intercepts an in-app link click and confirms before leaving', async () => {
    renderPage();
    await screen.findByRole('button', { name: /Brand/ });
    fireEvent.click(screen.getByRole('button', { name: /Brand/ }));
    const field = await screen.findByLabelText('Panel Name');
    fireEvent.change(field, { target: { value: 'Renamed panel' } });

    // A link rendered inside the page root, as a nav or in-page link would be.
    const link = document.createElement('a');
    link.href = '/admin/plugins';
    link.textContent = 'Plugins';
    field.parentElement!.appendChild(link);

    const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    link.dispatchEvent(clickEvent);

    expect(clickEvent.defaultPrevented).toBe(true);
    await screen.findByText('Discard unsaved theme changes?');

    // Cancelling keeps the admin on the page with the edit intact.
    fireEvent.click(screen.getByRole('button', { name: /^Cancel$/ }));
    await waitFor(() =>
      expect(screen.queryByText('Discard unsaved theme changes?')).not.toBeInTheDocument(),
    );
    expect(screen.getByDisplayValue('Renamed panel')).toBeInTheDocument();
    link.remove();
  });

  it('does not intercept in-app links when the form is clean', async () => {
    renderPage();
    // The Presets tab is the landing tab, so reach Brand before picking a field.
    fireEvent.click(await screen.findByRole('button', { name: /Brand/ }));
    const field = await screen.findByLabelText('Panel Name');
    const link = document.createElement('a');
    link.href = '/admin/plugins';
    link.textContent = 'Plugins';
    field.parentElement!.appendChild(link);

    const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    link.dispatchEvent(clickEvent);

    expect(clickEvent.defaultPrevented).toBe(false);
    expect(screen.queryByText('Discard unsaved theme changes?')).not.toBeInTheDocument();
    link.remove();
  });

  it('switches immediately when nothing is dirty', async () => {
    renderPage();
    const colors = await screen.findByRole('button', { name: /Colors/ });
    fireEvent.click(colors);

    expect(screen.queryByText('Discard unsaved theme changes?')).not.toBeInTheDocument();
    expect(document.getElementById('brand-colors')).toBeInTheDocument();
  });
});

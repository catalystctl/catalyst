import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import SearchPalette from './SearchPalette';

const navigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => navigate,
}));
vi.mock('../../stores/authStore', () => ({
  useAuthStore: (selector: (state: { user: { permissions: string[] } }) => unknown) =>
    selector({ user: { permissions: ['*'] } }),
}));
vi.mock('../../hooks/useServers', () => ({ useServers: () => ({ data: [], isLoading: false }) }));
vi.mock('../../hooks/useNodes', () => ({
  useNodes: () => ({ data: [], isLoading: false }),
  useAccessibleNodes: () => ({ data: { nodes: [], hasWildcard: false } }),
}));
vi.mock('../../hooks/useTemplates', () => ({ useTemplates: () => ({ data: [], isLoading: false }) }));
vi.mock('../../hooks/useServerDatabases', () => ({ useAvailableDatabaseHosts: () => ({ data: [] }) }));
vi.mock('../../plugins/hooks', () => ({
  usePluginTabs: () => [
    { id: 'tickets', label: 'Tickets', location: 'admin', order: 1 },
    { id: 'secret', label: 'Secret Tab', location: 'admin', order: 2, requiredPermissions: ['admin.write'] },
  ],
}));

beforeEach(() => {
  navigate.mockClear();
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

describe('SearchPalette', () => {
  it('navigates to the Create server URL intent on keyboard activation', async () => {
    const onClose = vi.fn();
    render(<SearchPalette isOpen onClose={onClose} />);
    const input = screen.getByRole('combobox', { name: /search pages/i });
    fireEvent.change(input, { target: { value: 'Create New Server' } });
    const option = await screen.findByRole('option', { name: /Create New Server/i });
    expect(input).toHaveAttribute('aria-activedescendant', option.id);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(navigate).toHaveBeenCalledWith('/servers?action=create');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('returns focus to its opener on Escape and handles empty results safely', async () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const onClose = vi.fn();
    render(<SearchPalette isOpen onClose={onClose} />);
    const input = screen.getByRole('combobox', { name: /search pages/i });
    fireEvent.change(input, { target: { value: 'unlikely-result-string-123456' } });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input).not.toHaveAttribute('aria-activedescendant');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
    await waitFor(() => expect(opener).toHaveFocus());
    opener.remove();
  });

  it('gives every theme section its own anchored deep link, with no duplicate destinations', async () => {
    // Contract ids from the keys-theme-profile handshake — the destination page
    // scrolls on exactly these. The overview row is the only unanchored one, so
    // ~11 rows can no longer all land at the top of one page.
    const sections = [
      ['Theme Settings', '/admin/theme-settings'],
      ['Branding & Identity', '/admin/theme-settings#branding'],
      ['Color Palette Generator', '/admin/theme-settings#palette-generator'],
      ['Brand Colors', '/admin/theme-settings#brand-colors'],
      ['Semantic Colors', '/admin/theme-settings#semantic-colors'],
      ['Dark Mode Surfaces', '/admin/theme-settings#dark-surfaces'],
      ['Light Mode Surfaces', '/admin/theme-settings#light-surfaces'],
      ['Theme Mode', '/admin/theme-settings#theme-mode'],
      ['Layout & Border Radius', '/admin/theme-settings#layout-radius'],
      ['Custom CSS', '/admin/theme-settings#custom-css'],
      ['SSO / OAuth Providers', '/admin/theme-settings#sso'],
    ] as const;

    for (const [label, target] of sections) {
      render(<SearchPalette isOpen onClose={vi.fn()} />);
      const input = screen.getByRole('combobox', { name: /search pages/i });
      fireEvent.change(input, { target: { value: label } });
      fireEvent.click(await screen.findByRole('option', { name: new RegExp(label, 'i') }));
      expect(navigate).toHaveBeenCalledWith(target);
      navigate.mockClear();
      cleanup();
    }

    const destinations = sections.map(([, target]) => target);
    expect(new Set(destinations).size).toBe(destinations.length);
  });

  it('lists admin plugin tabs from the same source as the rail', async () => {
    render(<SearchPalette isOpen onClose={vi.fn()} />);
    const input = screen.getByRole('combobox', { name: /search pages/i });
    fireEvent.change(input, { target: { value: 'Tickets' } });
    fireEvent.click(await screen.findByRole('option', { name: /Tickets/i }));
    expect(navigate).toHaveBeenCalledWith('/admin/plugin/tickets');
  });

  it('offers permission-gated quick actions beyond create-server', async () => {
    render(<SearchPalette isOpen onClose={vi.fn()} />);
    const input = screen.getByRole('combobox', { name: /search pages/i });
    // Quick actions are searched by their translated label and keywords, so the
    // query and the option name are the English copy from the catalog
    // (layout:search.quickActions.createUser.label = "New User").
    fireEvent.change(input, { target: { value: 'New User' } });
    const option = await screen.findByRole('option', { name: /New User/i });
    fireEvent.click(option);
    expect(navigate).toHaveBeenCalledWith('/admin/users');
  });

  it('finds API keys already in the cache without fetching', async () => {
    const { queryClient } = await import('@/lib/queryClient');
    const { qk } = await import('@/lib/queryKeys');
    queryClient.setQueryData(qk.apiKeys(), [
      { id: 'key_1', name: 'CI deploy key', enabled: true, start: 'sk_live_abc', prefix: 'sk_live' },
    ]);
    try {
      render(<SearchPalette isOpen onClose={vi.fn()} />);
      const input = screen.getByRole('combobox', { name: /search pages/i });
      fireEvent.change(input, { target: { value: 'CI deploy key' } });
      const option = await screen.findByRole('option', { name: /CI deploy key/i });
      fireEvent.click(option);
      expect(navigate).toHaveBeenCalledWith('/admin/api-keys');
    } finally {
      queryClient.removeQueries({ queryKey: qk.apiKeys() });
    }
  });

  it('marks the list expanded only while it has results', async () => {
    render(<SearchPalette isOpen onClose={vi.fn()} />);
    const input = screen.getByRole('combobox', { name: /search pages/i });
    expect(input).toHaveAttribute('aria-expanded', 'true');
    fireEvent.change(input, { target: { value: 'unlikely-result-string-123456' } });
    expect(input).toHaveAttribute('aria-expanded', 'false');
  });

  it('exposes the result groups so the listbox is not a flat soup', async () => {
    render(<SearchPalette isOpen onClose={vi.fn()} />);
    const groups = screen.getAllByRole('group');
    expect(groups.length).toBeGreaterThan(0);
    for (const group of groups) {
      expect(group.getAttribute('aria-label')).toBeTruthy();
    }
  });

  it('locks the page behind the palette while it is open', () => {
    const { unmount } = render(<SearchPalette isOpen onClose={vi.fn()} />);
    expect(document.body.style.overflow).toBe('hidden');
    unmount();
    expect(document.body.style.overflow).not.toBe('hidden');
  });
});
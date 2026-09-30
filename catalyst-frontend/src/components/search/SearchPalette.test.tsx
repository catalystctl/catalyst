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
});

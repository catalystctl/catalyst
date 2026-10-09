import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const navigate = vi.fn();
const scrollToIndex = vi.fn();
const state = { data: [] as any[], isLoading: false, isError: false, refetch: vi.fn() };

vi.mock('@/csync', () => ({
  useVirtualizer: ({ count, getItemKey }: { count: number; getItemKey: (index: number) => unknown }) => ({
    getVirtualItems: () => Array.from({ length: count }, (_, index) => ({ index, key: getItemKey(index), start: index * 56 })),
    getTotalSize: () => count * 56,
    measureElement: vi.fn(),
    scrollToIndex,
  }),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('react-router-dom', () => ({
  Link: ({ children, to, ...rest }: any) => <a href={to} {...rest}>{children}</a>,
  useNavigate: () => navigate,
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
}));
vi.mock('../../../hooks/useServers', () => ({ useServers: () => state }));
vi.mock('../../../hooks/useNodes', () => ({ useAccessibleNodes: () => ({ data: { nodes: [], hasWildcard: true } }) }));
vi.mock('../../../stores/authStore', () => ({
  useAuthStore: (select: (value: any) => unknown) => select({ user: { id: 'owner', permissions: ['*'] } }),
}));
vi.mock('../../../components/servers/CreateServerModal', () => ({ default: () => null }));
vi.mock('../../../components/servers/ServerControls', () => ({ default: () => null }));

import ServersPage from '../ServersPage';

const server = (id: string, name = id) => ({
  id, name, ownerId: 'owner', status: 'stopped', nodeName: 'node-1', node: { hostname: 'node-1' },
  template: { name: 'Minecraft' }, templateId: 'template-1',
});

describe('ServersPage virtualized keyboard navigation', () => {
  afterEach(() => { cleanup(); state.data = []; scrollToIndex.mockReset(); navigate.mockReset(); });

  it('renders virtual rows with stable server indexes and moves focus with ArrowDown', () => {
    state.data = [server('server-1', 'Alpha'), server('server-2', 'Bravo'), server('server-3', 'Charlie')];
    render(<ServersPage />);

    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(rows[1].parentElement).toHaveAttribute('data-server-index', '1');
    rows[0].focus();
    fireEvent.keyDown(rows[0], { key: 'ArrowDown' });
    expect(scrollToIndex).toHaveBeenCalledWith(1, { align: 'auto' });
  });

  it('navigates to the server when Enter is pressed on its row', () => {
    state.data = [server('server-1', 'Alpha')];
    render(<ServersPage />);
    fireEvent.keyDown(screen.getByRole('listitem'), { key: 'Enter' });
    expect(navigate).toHaveBeenCalledWith('/servers/server-1');
  });
});

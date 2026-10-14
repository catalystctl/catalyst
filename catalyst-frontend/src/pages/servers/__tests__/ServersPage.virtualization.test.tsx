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

  it('hugs the last row instead of stretching to the page bottom', () => {
    // The deck is content-height: it ends just past the last row. It must not
    // take flex-1 (which would stretch it to the shell edge and leave the row
    // area padded with empty space), but it must stay shrinkable so a long
    // fleet still caps at the viewport.
    state.data = [server('server-1', 'Alpha')];
    const { container } = render(<ServersPage />);

    const page = container.firstElementChild as HTMLElement;
    expect(page.className).toContain('h-full');

    const panel = container.querySelector('.server-list-container') as HTMLElement;
    expect(panel.className).toContain('shrink');
    expect(panel.className).not.toContain('flex-1');
    expect(panel.className).toContain('overflow-hidden');

    const scroller = screen.getByRole('list');
    expect(scroller.className).toContain('shrink');
    expect(scroller.className).toContain('overflow-y-auto');
    expect(scroller.className).toContain('min-h-0');
  });

  it('keeps a readable floor on the empty state', () => {
    state.data = [];
    render(<ServersPage />);
    expect(screen.getByRole('list').className).toContain('min-h-[12rem]');
  });

  it('hugs each metric value to its bar, spacing the resources by column', () => {
    // The value must sit tight against its own bar so the pair reads as one
    // unit; the air between CPU / RAM / DISK comes from the grid column, not
    // from a shared value box that right-aligns short values away from the bar.
    state.data = [server('server-1', 'Alpha')];
    const { container } = render(<ServersPage />);

    const row = container.querySelector('[role="listitem"]') as HTMLElement;
    const metrics = row.querySelectorAll('.server-list-xl');
    expect(metrics).toHaveLength(3);
    metrics.forEach((cell) => {
      expect(cell.className).toContain('gap-2');
      expect(cell.className).not.toContain('justify-end');
      const value = cell.lastElementChild as HTMLElement;
      expect(value.className).not.toContain('min-w-');
      expect(value.className).not.toContain('text-right');
    });
  });

  it('gives the status filter its own full-width row', () => {
    // Filters used to share one wrapping row, so the search box lost width to
    // the select as soon as the filter row filled up.
    state.data = [server('server-1', 'Alpha')];
    render(<ServersPage />);

    const trigger = screen.getByRole('combobox');
    const row = trigger.closest('div');
    expect(row?.className).toContain('w-full');
  });
});

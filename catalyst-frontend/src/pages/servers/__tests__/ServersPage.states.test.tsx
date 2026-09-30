import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const refetch = vi.fn();
const serversState = { current: { data: undefined as unknown, isLoading: false, isError: false, refetch } };

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('react-router-dom', () => ({
  Link: ({ children, to, ...rest }: { children?: React.ReactNode; to: string }) => <a href={to} {...rest}>{children}</a>,
  useNavigate: () => vi.fn(),
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
}));
vi.mock('../../../hooks/useServers', () => ({ useServers: () => serversState.current }));
vi.mock('../../../hooks/useNodes', () => ({ useAccessibleNodes: () => ({ data: { nodes: [], hasWildcard: true } }) }));
vi.mock('../../../stores/authStore', () => ({
  useAuthStore: (select: (state: { user: { id: string; permissions: string[] } }) => unknown) =>
    select({ user: { id: 'user-1', permissions: ['*'] } }),
}));
vi.mock('../../../components/servers/CreateServerModal', () => ({ default: () => null }));
vi.mock('../../../components/servers/ServerControls', () => ({ default: () => null }));

import ServersPage from '../ServersPage';

describe('ServersPage load states', () => {
  afterEach(() => { cleanup(); refetch.mockReset(); });

  it('shows a retryable error instead of an empty fleet when the request fails', () => {
    serversState.current = { data: undefined, isLoading: false, isError: true, refetch };
    render(<ServersPage />);
    expect(screen.getByRole('button', { name: 'common:actions.retry' })).toBeInTheDocument();
    expect(screen.queryByText('list.emptyTitle')).not.toBeInTheDocument();
  });

  it('shows the empty state only when the request succeeded with no servers', () => {
    serversState.current = { data: [], isLoading: false, isError: false, refetch };
    render(<ServersPage />);
    expect(screen.getByText('list.emptyTitle')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'common:actions.retry' })).not.toBeInTheDocument();
  });
});

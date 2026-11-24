import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient } from '@/csync';

const location = { current: '/servers/srv_abc12345/backups' };
const queryClientRef: { current: QueryClient | null } = { current: null };

vi.mock('react-router-dom', () => ({
  Link: ({ children, to, ...rest }: { children?: React.ReactNode; to: string }) => (
    <a href={to} {...rest}>{children}</a>
  ),
  useLocation: () => ({ pathname: location.current }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    // Key fallback keeps the assertions about *labels* honest: a translated
    // value proves the key exists, a raw key proves the segment is unmapped.
    t: (key: string) => ({
      'layout:breadcrumbs.nav': 'Breadcrumb',
      'layout:nav.dashboard': 'Dashboard',
      'layout:nav.servers': 'Servers',
      'layout:nav.nodes': 'Nodes',
      'layout:nav.environment': 'Environment',
      'layout:breadcrumbs.allocations': 'Allocations',
      'layout:breadcrumbs.nests': 'Nests',
      'layout:breadcrumbs.backups': 'Backups',
    })[key] ?? key,
  }),
}));
vi.mock('@/csync', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/csync')>();
  return {
    ...actual,
    useQueryClient: () => queryClientRef.current,
  };
});

const { default: Breadcrumbs } = await import('../Breadcrumbs');
const { qk } = await import('@/lib/queryKeys');

describe('Breadcrumbs', () => {
  beforeEach(() => {
    queryClientRef.current = new QueryClient();
    location.current = '/servers/srv_abc12345/backups';
  });
  afterEach(cleanup);

  it('resolves a server id to its name from the route cache', () => {
    queryClientRef.current!.setQueryData(qk.server('srv_abc12345'), { id: 'srv_abc12345', name: 'Survival' });
    render(<Breadcrumbs />);
    expect(screen.getByRole('link', { name: 'Survival' })).toHaveAttribute('href', '/servers/srv_abc12345');
    expect(screen.queryByText('srv_abc1…')).not.toBeInTheDocument();
  });

  it('falls back to a truncated id when the entity is not cached', () => {
    render(<Breadcrumbs />);
    expect(screen.getByRole('link', { name: 'srv_abc1…' })).toHaveAttribute('href', '/servers/srv_abc12345');
  });

  it('resolves a node id from the nodes cache', () => {
    location.current = '/admin/nodes/nod_xyz98765';
    queryClientRef.current!.setQueryData(qk.node('nod_xyz98765'), { id: 'nod_xyz98765', name: 'eu-west-1' });
    render(<Breadcrumbs />);
    // The crumb label carries the page marker; the id must be gone.
    expect(screen.getByText('eu-west-1').closest('[aria-current="page"]')).not.toBeNull();
    expect(screen.queryByText('nod_xyz9…')).not.toBeInTheDocument();
  });

  it('labels environment / allocations / nests segments instead of leaking English', () => {
    location.current = '/admin/environment';
    const { unmount } = render(<Breadcrumbs />);
    expect(screen.getByText('Environment')).toBeInTheDocument();
    unmount();

    location.current = '/admin/nodes/nod_1/allocations';
    const second = render(<Breadcrumbs />);
    expect(screen.getByText('Allocations')).toBeInTheDocument();
    second.unmount();

    location.current = '/admin/templates/nests';
    render(<Breadcrumbs />);
    expect(screen.getByText('Nests')).toBeInTheDocument();
  });

  it('updates the crumb when the entity query lands after first paint', async () => {
    render(<Breadcrumbs />);
    expect(screen.getByRole('link', { name: 'srv_abc1…' })).toBeInTheDocument();

    queryClientRef.current!.setQueryData(qk.server('srv_abc12345'), { id: 'srv_abc12345', name: 'Creative' });
    // The cache subscription re-renders the nav once the name is available.
    expect(await screen.findByRole('link', { name: 'Creative' })).toHaveAttribute('href', '/servers/srv_abc12345');
  });
});
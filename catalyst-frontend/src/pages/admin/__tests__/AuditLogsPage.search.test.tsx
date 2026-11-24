/**
 * Admin > Audit logs — server-side search (audit D19).
 *
 * The search box used to filter only the 50 rows already on screen. It now
 * sends a debounced `q` to the API, so:
 *  - typing sends `q` only after the debounce, not on every keystroke,
 *  - the query carries `q` and resets to page 1,
 *  - the page renders exactly what the server returned (no client-side
 *    filtering that would hide rows the server matched),
 *  - pagination controls stay available for a searched result set,
 *  - a search that returns nothing says so with the search-specific copy.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const h = vi.hoisted(() => ({
  calls: [] as Array<Record<string, unknown>>,
  logs: [] as any[],
  pagination: { page: 1, limit: 50, total: 0, totalPages: 1 },
}));

vi.mock('../../../services/api/admin', () => ({
  adminApi: {
    listAuditLogs: async (params: Record<string, unknown>) => {
      h.calls.push(params);
      return { logs: h.logs, pagination: h.pagination };
    },
    exportAuditLogs: vi.fn(),
  },
}));

vi.mock('../../../services/api/admin-events', () => ({
  createAdminEventsStream: () => () => {},
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: any) =>
      values && Object.keys(values).length > 0
        ? `${key}:${JSON.stringify(values)}`
        : key,
    i18n: { language: 'en' },
  }),
}));

const auditLog = (id: string, action: string, resource = 'server') => ({
  id,
  userId: 'user-1',
  action,
  resource,
  resourceId: `res-${id}`,
  details: {},
  timestamp: new Date().toISOString(),
  user: { id: 'user-1', username: 'admin', email: 'admin@example.com' },
  ipAddress: '127.0.0.1',
});

import AuditLogsPage from '../AuditLogsPage';
import { QueryClient, QueryClientProvider } from '@/csync';

// Each test gets its own client: the module singleton caches by query key, and
// a stale page from a previous test would silently substitute for the fixture.
const renderPage = () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AuditLogsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

describe('AuditLogsPage server-side search', () => {
  beforeEach(() => {
    h.calls = [];
    h.logs = [];
    h.pagination = { page: 1, limit: 50, total: 0, totalPages: 1 };
  });

  afterEach(cleanup);

  it('sends the typed query as `q` after the debounce, not on every keystroke', async () => {
    renderPage();
    const input = screen.getByPlaceholderText('audit.searchPlaceholder');
    fireEvent.change(input, { target: { value: 'login-1' } });
    fireEvent.change(input, { target: { value: 'login-failed' } });
    // Debounced: the intermediate value never reaches the API.
    expect(h.calls.some((call) => call.q === 'login-1')).toBe(false);
    await waitFor(() =>
      expect(h.calls.some((call) => call.q === 'login-failed')).toBe(true),
    );
    expect(h.calls.some((call) => call.q === 'login-1')).toBe(false);
  });

  it('renders the rows the server returned instead of re-filtering them client-side', async () => {
    // The server matched this row on its stored details, which the old
    // client-side filter never looked at.
    h.logs = [auditLog('a1', 'config_updated')];
    renderPage();
    const label = 'admin-access:audit.actions.configUpdated';
    // Generous timeout: the debounce plus a parallel worker can exceed the default.
    expect(await screen.findByText(label, undefined, { timeout: 5000 })).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('audit.searchPlaceholder'), {
      target: { value: 'needle-in-details' },
    });
    await waitFor(
      () => expect(h.calls.some((call) => call.q === 'needle-in-details')).toBe(true),
      { timeout: 5000 },
    );
    // Still shown: filtering is the server's job now.
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('keeps pagination for a searched result set', async () => {
    h.logs = [auditLog('a1', 'config_updated')];
    h.pagination = { page: 1, limit: 50, total: 120, totalPages: 3 };
    renderPage();
    fireEvent.change(screen.getByPlaceholderText('audit.searchPlaceholder'), {
      target: { value: 'needle' },
    });
    // Page 2 is reachable while a search is active.
    const next = await screen.findByRole('button', { name: /Next/i });
    fireEvent.click(next);
    await waitFor(() =>
      expect(h.calls.some((call) => call.q === 'needle' && call.page === 2)).toBe(true),
    );
  });

  it('shows the search-specific empty copy when nothing matches', async () => {
    h.logs = [];
    renderPage();
    fireEvent.change(screen.getByPlaceholderText('audit.searchPlaceholder'), {
      target: { value: 'nothing-matches' },
    });
    expect(await screen.findByText('audit.emptySearchDescription')).toBeInTheDocument();
  });
});

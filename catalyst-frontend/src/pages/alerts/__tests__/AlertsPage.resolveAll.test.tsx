/**
 * Alerts page — "Resolve all" safety ceremony and severity filter (audit D24).
 *
 * Resolving the whole filtered set used to be one unguarded click that
 * disabled itself while running. It now:
 *  - opens a ConfirmDialog naming the count it will resolve,
 *  - only fires the bulk mutation from that dialog's confirm action,
 *  - shows a spinner + "Resolving…" label while the request is in flight,
 *  - honours the severity filter, so the count and the target set follow it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const h = vi.hoisted(() => ({
  resolve: vi.fn(),
  bulkResolve: vi.fn(),
  bulkPending: false,
  listCalls: [] as Array<Record<string, unknown>>,
  alerts: [] as any[],
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: any) =>
      values && typeof values === 'object' && 'count' in values
        ? `${key}#${values.count}`
        : key,
    i18n: { language: 'en' },
  }),
}));

vi.mock('@/csync', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/csync')>()),
  useVirtualizer: ({ count, getItemKey }: any) => ({
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({ index, key: getItemKey(index), start: index * 96 })),
    getTotalSize: () => count * 96,
    measureElement: vi.fn(),
  }),
}));

vi.mock('../../../services/api/alerts', () => ({
  alertsApi: {
    list: async (params: Record<string, unknown>) => {
      h.listCalls.push(params);
      return { alerts: h.alerts, pagination: {} };
    },
    statsScoped: async () => ({
      total: 3,
      unresolved: 2,
      bySeverity: { critical: 1, warning: 1, info: 0 },
      byType: {},
    }),
    resolve: h.resolve,
    bulkResolve: h.bulkResolve,
    listRules: async () => [],
  },
}));

vi.mock('../../../hooks/useAlertRules', () => ({
  useAlertRules: () => ({ data: [] }),
}));

vi.mock('../../../hooks/useNodes', () => ({ useNodes: () => ({ data: [] }) }));
vi.mock('../../../hooks/useServers', () => ({ useServers: () => ({ data: [] }) }));
vi.mock('../../../hooks/useStreamAwareInterval', () => ({
  useStreamAwareInterval: () => false,
}));

vi.mock('../../../stores/authStore', () => ({
  useAuthStore: (selector: any) => selector({ user: { id: 'admin-1' } }),
}));

vi.mock('../../../utils/notify', () => ({
  notifySuccess: vi.fn(),
  notifyError: vi.fn(),
}));

import AlertsPage from '../AlertsPage';

const alert = (id: string, severity: string) => ({
  id,
  severity,
  resolved: false,
  title: `Alert ${id}`,
  message: 'msg',
  createdAt: new Date().toISOString(),
  deliveries: [],
  rule: null,
  server: null,
  node: null,
});

const renderPage = () =>
  render(
    <MemoryRouter>
      <AlertsPage scope="all" showAdminTargets />
    </MemoryRouter>,
  );

describe('AlertsPage resolve-all confirmation', () => {
  beforeEach(() => {
    h.resolve.mockReset();
    h.bulkResolve.mockReset();
    h.bulkResolve.mockResolvedValue({ success: true });
    h.listCalls = [];
    h.bulkPending = false;
    h.alerts = [alert('a1', 'critical'), alert('a2', 'warning')];
  });

  afterEach(cleanup);

  it('opens a confirmation naming the count instead of resolving immediately', async () => {
    renderPage();
    const button = await screen.findByRole('button', { name: /page\.resolveAll/ });
    fireEvent.click(button);
    // Nothing resolved yet.
    expect(h.bulkResolve).not.toHaveBeenCalled();
    expect((await screen.findAllByText('page.resolveAllTitle')).length).toBeGreaterThan(0);
    expect(screen.getByText('page.resolveAllConfirm#2')).toBeInTheDocument();
  });

  it('resolves the unresolved ids only after the dialog is confirmed', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /page\.resolveAll/ }));
    const confirmButtons = await screen.findAllByRole('button', { name: /page\.resolveAll/ });
    // The dialog action is the last match (the toolbar button is the first).
    fireEvent.click(confirmButtons[confirmButtons.length - 1]);
    await waitFor(() => expect(h.bulkResolve).toHaveBeenCalledTimes(1));
    expect(h.bulkResolve).toHaveBeenCalledWith(['a1', 'a2']);
  });

  it('passes the severity filter to the API and to the query key', async () => {
    renderPage();
    const select = await screen.findByLabelText('page.filterSeverityAria');
    fireEvent.change(select, { target: { value: 'critical' } });
    await waitFor(() =>
      expect(h.listCalls.some((call) => call.severity === 'critical')).toBe(true),
    );
  });

  it('offers severity options with the counts already loaded', async () => {
    renderPage();
    const select = await screen.findByLabelText('page.filterSeverityAria');
    const options = Array.from(select.querySelectorAll('option')).map((o) => o.textContent);
    expect(options).toContain('page.severityCritical#1');
    expect(options).toContain('page.severityWarning#1');
    expect(options).toContain('page.severityInfo#0');
  });
});

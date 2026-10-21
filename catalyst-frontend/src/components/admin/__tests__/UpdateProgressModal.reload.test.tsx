/**
 * UpdateProgressModal — auto-reload after a panel update.
 *
 * Regression (customer report, 1.85.0 → 1.85.1 update): the restart watch
 * deactivated as soon as the polled state flipped `restarting → idle`. The
 * NEW backend boots with in-memory state `idle`, so the 2s poll could flip
 * the phase before the 15s grace ended, cancelling the /health probe — the
 * page never auto-reloaded and the "update available" flyout stayed until a
 * manual refresh.
 *
 * Pinned behavior:
 *  1. Once `restarting` has been observed, the /health watch is STICKY and
 *     survives a later `idle` flip (panel back → reload scheduled).
 *  2. The SSE/boot `completed` state also counts as "panel back" without
 *     needing the health probe.
 *  3. Close is NOT blocked once the panel is back (completed/idle-after-
 *     restarting), so the admin can dismiss the modal.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';

const { queryState, healthMock } = vi.hoisted(() => ({
  queryState: { current: undefined as any },
  healthMock: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/csync', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/csync')>();
  return {
    ...actual,
    useQuery: ({ queryKey }: any) => {
      void queryKey;
      return { data: queryState.current };
    },
    useQueryClient: () => ({
      invalidateQueries: vi.fn(),
      setQueryData: vi.fn(),
    }),
  };
});

vi.mock('@/components/ui/dialog', () => {
  const h = () => (props: any) => {
    const { children } = props;
    void props;
    return <div>{children}</div>;
  };
  return {
    Dialog: ({ children, open }: any) => (open ? <div>{children}</div> : null),
    DialogContent: h(),
    DialogHeader: h(),
    DialogTitle: h(),
    DialogDescription: h(),
    DialogBody: h(),
    DialogFooter: h(),
  };
});

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, disabled }: any) => (
    <button onClick={onClick} disabled={disabled}>{children}</button>
  ),
}));

vi.mock('@/components/deck/primitives', () => ({
  BracketLabel: ({ children }: any) => <span>{children}</span>,
  StatusLed: () => <span />,
}));

vi.mock('@/i18n/format', () => ({ formatRelativeTime: () => 'just now' }));

vi.mock('../../services/api/admin', () => ({
  adminApi: { updateState: vi.fn(async () => queryState.current) },
}));

vi.mock('framer-motion', () => ({
  motion: { div: ({ children }: any) => <div>{children}</div> },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

import UpdateProgressModal from '../UpdateProgressModal';

function setHealth(ok: boolean) {
  healthMock.mockImplementation(() =>
    ok ? Promise.resolve({ ok: true }) : Promise.reject(new Error('down')),
  );
}

describe('UpdateProgressModal auto-reload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    queryState.current = undefined;
    setHealth(false);
    // The restart watch probes /health with bare fetch (not apiClient).
    global.fetch = healthMock as unknown as typeof fetch;
    // jsdom's location.reload is a non-configurable no-op — replace the whole
    // location object so reload calls are observable.
    vi.stubGlobal('location', { ...window.location, reload: vi.fn() });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  const reloadSpy = () => (location.reload as unknown as ReturnType<typeof vi.fn>);

  const renderModal = () => render(<UpdateProgressModal open onClose={() => {}} />);

  it('reloads after restarting → idle flip once /health answers (sticky watch)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    queryState.current = { state: 'restarting', message: null, logs: [] };
    renderModal();
    // flush mount effects (fetch/health rejections land as microtasks)
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    // Grace period (15s) + first probe: backend still down.
    await act(async () => { await vi.advanceTimersByTimeAsync(16_000); });
    expect(reloadSpy()).not.toHaveBeenCalled();

    // The poll hits the NEW backend, which reports `idle` (its in-memory
    // state boots at idle). Historically this deactivated the watch.
    await act(async () => {
      queryState.current = { state: 'idle', message: null, logs: [] };
      await vi.advanceTimersByTimeAsync(3_000);
    });

    // The watch must still be alive: next probe succeeds → success → reload.
    setHealth(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(4_000); });
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
    expect(reloadSpy()).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('catalyst-update-completed-toast')).toBe('1');
  });

  it('treats the boot-announced completed state as panel-back and reloads', async () => {
    queryState.current = { state: 'completed', message: 'Panel update complete.', logs: [] };
    renderModal();

    await waitFor(() => {
      expect(screen.getByText('update.progress.complete')).toBeInTheDocument();
    });

    // Success lingers 2.5s, then reloads — no health probing needed.
    expect(reloadSpy()).not.toHaveBeenCalled();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 2_800));
    });
    expect(reloadSpy()).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('catalyst-update-completed-toast')).toBe('1');
  });

  it('close is enabled once the panel is back (not blocked on idle)', async () => {
    queryState.current = { state: 'completed', message: null, logs: [] };
    renderModal();

    const close = await screen.findByRole('button');
    expect(close).not.toBeDisabled();
  });

  it('close stays blocked while the update is running and panel is down', async () => {
    queryState.current = { state: 'pulling', message: null, logs: [] };
    renderModal();

    const close = await screen.findByRole('button');
    expect(close).toBeDisabled();
  });
});

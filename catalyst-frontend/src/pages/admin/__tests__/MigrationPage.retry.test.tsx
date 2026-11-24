/**
 * Migration page — step retry pending state and cancel confirmation.
 *
 * Audit (B "missing pending/feedback states") found the failed-step retry was a
 * ~12 px unstyled control with no pending state, and cancelling a running job
 * fired on one click. Pins:
 *  - a failed step's retry is a real icon button with an accessible name,
 *  - retrying calls the retry-step API with that step id,
 *  - cancelling a running job opens a confirmation and does not call the API
 *    until it is confirmed.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const h = vi.hoisted(() => ({
  retryStep: vi.fn(),
  cancel: vi.fn(),
  job: null as any,
  steps: [] as any[],
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
}));

vi.mock('../../../services/api/migration', () => ({
  migrationApi: {
    getCatalystNodes: async () => [],
    listJobs: async () => [h.job],
    getStatus: async () => h.job,
    getSteps: async () => ({ steps: h.steps }),
    retryStep: h.retryStep,
    cancel: h.cancel,
    pause: vi.fn(),
    resume: vi.fn(),
    test: vi.fn(),
    start: vi.fn(),
  },
}));

vi.mock('../../../utils/notify', () => ({
  notifySuccess: vi.fn(),
  notifyError: vi.fn(),
  notifyInfo: vi.fn(),
}));

import MigrationPage from '../MigrationPage';

// jsdom has no layout: the page scrolls the active phase into view.
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

const runningJob = () => ({
  id: 'job-1',
  status: 'running',
  sourceUrl: 'https://pt.example.com',
  progress: { total: 10, completed: 3, failed: 1, skipped: 0 },
  createdAt: new Date().toISOString(),
  currentPhase: 'servers',
});

const failedStep = () => ({
  id: 'step-1',
  jobId: 'job-1',
  phase: 'servers',
  action: 'migrate_server',
  status: 'failed',
  error: 'boom',
  metadata: { serverName: 'Survival' },
});

/** Opens the active-job view through the History tab (the job row link). */
const openActiveJob = async () => {
  render(
    <MemoryRouter>
      <MigrationPage />
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByText('migration.tabs.history'));
  const row = await screen.findByText('https://pt.example.com');
  fireEvent.click(row);
  await screen.findByText('migration.progress.title');
};

describe('MigrationPage retry and cancel', () => {
  beforeEach(() => {
    h.retryStep.mockReset();
    h.cancel.mockReset();
    h.job = runningJob();
    h.steps = [failedStep()];
  });

  afterEach(cleanup);

  it('renders the failed-step retry as an accessible icon button', async () => {
    await openActiveJob();
    const retry = await screen.findByRole('button', { name: 'common:actions.retry' });
    expect(retry).toBeEnabled();
  });

  it('retries that exact step through the API', async () => {
    await openActiveJob();
    fireEvent.click(await screen.findByRole('button', { name: 'common:actions.retry' }));
    await waitFor(() => expect(h.retryStep).toHaveBeenCalledTimes(1));
    expect(h.retryStep.mock.calls[0]).toEqual(['job-1', 'step-1']);
  });

  it('confirms before cancelling a running job', async () => {
    await openActiveJob();
    fireEvent.click(await screen.findByRole('button', { name: /common:actions.cancel/ }));
    expect(h.cancel).not.toHaveBeenCalled();
    expect(await screen.findByText('migration.cancelTitle')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'migration.actions.cancelJob' })[0]);
    await waitFor(() => expect(h.cancel).toHaveBeenCalledWith('job-1'));
  });
});

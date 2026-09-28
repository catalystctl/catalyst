/**
 * EnvRestartNotice — the global "Restart required" prompt.
 *
 * Regression: the prompt used to be a blocking modal that reappeared on every
 * page load, so an operator with a pending (or spurious) restart could not use
 * the panel. It now lists the pending variables and remembers "Later" for that
 * exact pending set.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

const h = vi.hoisted(() => ({
  status: {
    restartRequired: true,
    changedKeys: ['PUBLIC_URL', 'CORS_ORIGIN'],
    strategy: 'supervised' as const,
  },
  mutate: vi.fn(),
}));

vi.mock('../../../hooks/useAuth', () => ({
  useAuth: () => ({ user: { permissions: ['admin.write'] } }),
}));

vi.mock('../../../hooks/useAdmin', () => ({
  useEnvRestartStatus: () => ({ data: h.status }),
  useRestartPanel: () => ({ mutate: h.mutate, isPending: false }),
}));

import EnvRestartNotice from '../EnvRestartNotice';

describe('EnvRestartNotice', () => {
  beforeEach(() => {
    window.localStorage.clear();
    h.mutate.mockReset();
    h.status = {
      restartRequired: true,
      changedKeys: ['PUBLIC_URL', 'CORS_ORIGIN'],
      strategy: 'supervised',
    };
  });

  afterEach(cleanup);

  it('lists the pending variables', () => {
    render(<EnvRestartNotice />);
    expect(screen.getByText('Restart required')).toBeInTheDocument();
    expect(screen.getByText('Waiting on: PUBLIC_URL, CORS_ORIGIN')).toBeInTheDocument();
  });

  it('remembers "Later" across reloads for the same pending set', () => {
    const first = render(<EnvRestartNotice />);
    fireEvent.click(screen.getByRole('button', { name: 'Later' }));
    expect(screen.queryByText('Restart required')).not.toBeInTheDocument();
    first.unmount();

    // A fresh mount (page reload) must not show the same prompt again.
    render(<EnvRestartNotice />);
    expect(screen.queryByText('Restart required')).not.toBeInTheDocument();
  });

  it('shows again when a different change is pending', () => {
    const first = render(<EnvRestartNotice />);
    fireEvent.click(screen.getByRole('button', { name: 'Later' }));
    first.unmount();

    h.status = { restartRequired: true, changedKeys: ['LOG_LEVEL'], strategy: 'supervised' };
    render(<EnvRestartNotice />);
    expect(screen.getByText('Waiting on: LOG_LEVEL')).toBeInTheDocument();
  });

  it('renders nothing when no restart is required', () => {
    h.status = { restartRequired: false, changedKeys: [], strategy: 'supervised' };
    render(<EnvRestartNotice />);
    expect(screen.queryByText('Restart required')).not.toBeInTheDocument();
  });
});

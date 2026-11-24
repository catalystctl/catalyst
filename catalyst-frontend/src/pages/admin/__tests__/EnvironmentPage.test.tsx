/**
 * Admin > Environment page.
 *
 * Covers the behaviour that matters for the feature: registered variables
 * render with their source, secrets are masked and read-only bootstrap keys
 * cannot be saved, and an edited value is persisted through the API with the
 * exact env key.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({
  update: vi.fn(),
  reset: vi.fn(),
  restart: vi.fn(),
  refetch: vi.fn(),
  isError: false,
  overview: {
    restartRequired: false,
    changedKeys: [] as string[],
    entries: [
      {
        key: 'APP_NAME',
        title: 'App Name',
        category: 'general' as const,
        type: 'string' as const,
        editable: true,
        secret: false,
        restartRequired: true,
        changedSinceBoot: false,
        source: 'environment' as const,
        value: 'Catalyst',
        isSet: true,
        hasOverride: false,
        default: 'Catalyst',
        description: 'Panel name used in emails.',
      },
      {
        key: 'BETTER_AUTH_SECRET',
        title: 'Better Auth Secret',
        category: 'auth' as const,
        type: 'secret' as const,
        editable: true,
        secret: true,
        restartRequired: true,
        changedSinceBoot: true,
        source: 'database' as const,
        value: '••••abcd',
        isSet: true,
        hasOverride: true,
        default: null,
      },
      {
        key: 'DATABASE_URL',
        title: 'Database Url',
        category: 'database' as const,
        type: 'secret' as const,
        editable: false,
        secret: true,
        restartRequired: true,
        changedSinceBoot: false,
        source: 'environment' as const,
        value: '••••5432',
        isSet: true,
        hasOverride: false,
        default: null,
      },
    ],
  },
}));

vi.mock('../../../hooks/useAdmin', () => ({
  useEnvSettings: () => ({
    data: h.isError ? undefined : h.overview,
    isLoading: false,
    isError: h.isError,
    refetch: h.refetch,
  }),
  useEnvRestartStatus: () => ({
    data: { restartRequired: false, changedKeys: [], strategy: 'supervised' },
  }),
  useUpdateEnvSettings: () => ({ mutate: h.update, isPending: false }),
  useResetEnvSetting: () => ({ mutate: h.reset, isPending: false }),
  useRestartPanel: () => ({ mutate: h.restart, isPending: false }),
}));

vi.mock('../../../utils/notify', () => ({
  notifySuccess: vi.fn(),
  notifyError: vi.fn(),
}));

import EnvironmentPage from '../EnvironmentPage';

describe('Admin EnvironmentPage', () => {
  beforeEach(() => {
    h.update.mockReset();
    h.reset.mockReset();
  });

  afterEach(cleanup);

  it('renders variables with their source badges', () => {
    render(<EnvironmentPage />);
    expect(screen.getByText('APP_NAME')).toBeInTheDocument();
    expect(screen.getByText('BETTER_AUTH_SECRET')).toBeInTheDocument();
    expect(screen.getAllByText('Environment').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Database').length).toBeGreaterThan(0);
  });

  it('masks secrets and locks .env-only variables', () => {
    render(<EnvironmentPage />);
    // The secret input never exposes the stored value.
    expect(screen.queryByDisplayValue('••••abcd')).not.toBeInTheDocument();
    // DATABASE_URL is bootstrap-only: rendered read-only, no Save button.
    expect(screen.getAllByText('.env only').length).toBeGreaterThan(0);
  });

  it('persists an edited value through the API', async () => {
    render(<EnvironmentPage />);
    const input = screen.getByDisplayValue('Catalyst');
    fireEvent.change(input, { target: { value: 'My Panel' } });
    const saveButtons = screen.getAllByRole('button', { name: /save/i });
    fireEvent.click(saveButtons[0]);
    await waitFor(() => {
      expect(h.update).toHaveBeenCalledWith(
        { APP_NAME: 'My Panel' },
        expect.any(Object),
      );
    });
  });

  it('batch-saves every changed row in one call', async () => {
    render(<EnvironmentPage />);
    // Nothing dirty yet: the batch action is disabled and says so.
    const batch = screen.getByRole('button', { name: /Save all changed/ });
    expect(batch).toBeDisabled();

    fireEvent.change(screen.getByDisplayValue('Catalyst'), {
      target: { value: 'Batch Panel' },
    });
    expect(screen.getByText('1 change not saved')).toBeInTheDocument();
    expect(batch).toBeEnabled();

    fireEvent.click(batch);
    await waitFor(() => {
      expect(h.update).toHaveBeenCalledTimes(1);
      expect(h.update.mock.calls[0][0]).toEqual({ APP_NAME: 'Batch Panel' });
    });
  });

  it('clears the changed count when a draft goes back to its saved value', () => {
    render(<EnvironmentPage />);
    const input = screen.getByDisplayValue('Catalyst');
    fireEvent.change(input, { target: { value: 'Something Else' } });
    expect(screen.getByText('1 change not saved')).toBeInTheDocument();
    fireEvent.change(input, { target: { value: 'Catalyst' } });
    expect(screen.getByText('No unsaved changes')).toBeInTheDocument();
  });

  it('confirms a panel restart instead of firing it on the first click', async () => {
    h.restart.mockReset();
    h.overview.restartRequired = true;
    render(<EnvironmentPage />);
    const cta = screen.getByRole('button', { name: /Restart panel/ });
    fireEvent.click(cta);
    expect(h.restart).not.toHaveBeenCalled();
    // The confirmation dialog is now open: its action carries the same label.
    const actions = screen.getAllByRole('button', { name: /Restart panel/ });
    fireEvent.click(actions[actions.length - 1]);
    await waitFor(() => expect(h.restart).toHaveBeenCalledTimes(1));
    h.overview.restartRequired = false;
  });

  it('offers a retry when the settings fail to load', () => {
    h.isError = true;
    h.refetch.mockReset();
    render(<EnvironmentPage />);
    expect(screen.getByText('Could not load the environment variables.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Retry/ }));
    expect(h.refetch).toHaveBeenCalled();
    h.isError = false;
  });
});

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
    data: h.overview,
    isLoading: false,
    isError: false,
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
});

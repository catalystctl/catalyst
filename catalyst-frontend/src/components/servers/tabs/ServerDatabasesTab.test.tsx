import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

/**
 * Safety ceremony: rotating a database password is irreversible for every
 * service already using it, and it used to fire on a single click while the
 * delete next to it asked for confirmation.
 */

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, opts?: Record<string, unknown>) => (opts ? `${key}:${JSON.stringify(opts)}` : key) }),
}));
vi.mock('../../shared/LastUpdated', () => ({ default: () => null }));
vi.mock('./DatabaseCredentialsDialog', () => ({ default: () => null }));

import ServerDatabasesTab from './ServerDatabasesTab';

const database = {
  id: 'db-1',
  name: 'srv_main',
  username: 'srv_main',
  password: 'secret',
  host: 'db.local',
  port: 3306,
  hostName: 'main',
} as never;

const renderTab = (overrides: Record<string, unknown> = {}) => {
  const props = {
    serverId: 'server-1',
    isSuspended: false,
    databases: [database],
    databasesLoading: false,
    databasesError: false,
    databaseHosts: [],
    databaseAllocation: 2,
    canManageDatabases: true,
    databaseHostId: '',
    onDatabaseHostIdChange: vi.fn(),
    databaseName: '',
    onDatabaseNameChange: vi.fn(),
    createPending: false,
    onCreate: vi.fn(),
    rotatePending: false,
    onRotate: vi.fn(),
    deletePending: false,
    onDelete: vi.fn(),
    revealedCredentials: null,
    onDismissRevealedCredentials: vi.fn(),
    ...overrides,
  };
  render(<ServerDatabasesTab {...(props as unknown as React.ComponentProps<typeof ServerDatabasesTab>)} />);
  return props;
};

describe('ServerDatabasesTab rotate confirmation', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('asks before rotating the password', () => {
    const props = renderTab();
    fireEvent.click(screen.getByRole('button', { name: 'tabs.databases.rotate' }));
    // Nothing happens on the first click.
    expect(props.onRotate).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    expect(screen.getByText(/tabs\.databases\.rotateConfirm/)).toBeTruthy();
  });

  it('rotates the right database once confirmed', () => {
    const props = renderTab();
    fireEvent.click(screen.getByRole('button', { name: 'tabs.databases.rotate' }));
    fireEvent.click(screen.getByRole('button', { name: 'tabs.databases.rotate' }));
    expect(props.onRotate).toHaveBeenCalledWith('db-1');
  });

  it('does nothing when the confirm is cancelled', () => {
    const props = renderTab();
    fireEvent.click(screen.getByRole('button', { name: 'tabs.databases.rotate' }));
    fireEvent.click(screen.getByRole('button', { name: 'common:actions.cancel' }));
    expect(props.onRotate).not.toHaveBeenCalled();
  });
});
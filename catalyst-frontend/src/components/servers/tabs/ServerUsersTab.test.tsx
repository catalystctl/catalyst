import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

/**
 * Safety ceremony: removing a user's access and cancelling an invite both used
 * to fire on a single click. They now ask first, like every other destructive
 * action in the panel. The invite row's email also truncates instead of
 * colliding with its actions.
 */

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key}:${JSON.stringify(opts)}` : key,
  }),
}));

import ServerUsersTab from './ServerUsersTab';

const entry = {
  id: 'access-1',
  userId: 'user-2',
  user: { username: 'alice', email: 'alice@example.com' },
  permissions: [],
};

const invite = {
  id: 'invite-1',
  email: 'bob.with.a.very.long.address@example.com',
  token: 'tok',
  expiresAt: '2026-12-01T10:00:00.000Z',
};

const renderTab = (overrides: Record<string, unknown> = {}) => {
  const props = {
    ownerId: 'owner-1',
    inviteEmail: '',
    onInviteEmailChange: vi.fn(),
    invitePreset: 'readOnly' as const,
    onInvitePresetChange: vi.fn(),
    invitePermissions: [],
    onInvitePermissionsChange: vi.fn(),
    permissionOptions: ['console.read'],
    createInvitePending: false,
    onCreateInvite: vi.fn(),
    permissionsData: [entry],
    accessPermissions: {},
    onAccessPermissionsChange: vi.fn(),
    saveAccessPending: false,
    onSaveAccess: vi.fn(),
    removeAccessPending: false,
    onRemoveAccess: vi.fn(),
    invites: [invite],
    cancelInvitePending: false,
    onCancelInvite: vi.fn(),
    regenerateInvitePending: false,
    onRegenerateInvite: vi.fn(),
    onCopyInviteLink: vi.fn(),
    ...overrides,
  };
  render(<ServerUsersTab {...(props as unknown as React.ComponentProps<typeof ServerUsersTab>)} />);
  return props;
};

describe('ServerUsersTab confirmations', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('asks before removing access', () => {
    const props = renderTab();
    fireEvent.click(screen.getByRole('button', { name: 'common:actions.remove' }));
    expect(props.onRemoveAccess).not.toHaveBeenCalled();
    expect(screen.getByText(/tabs\.users\.removeAccessConfirm/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'common:actions.remove' }));
    expect(props.onRemoveAccess).toHaveBeenCalledWith('user-2');
  });

  it('asks before cancelling an invite', () => {
    const props = renderTab();
    fireEvent.click(screen.getByRole('button', { name: 'common:actions.cancel' }));
    expect(props.onCancelInvite).not.toHaveBeenCalled();
    expect(screen.getByText(/tabs\.users\.cancelInviteConfirm/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'tabs.users.cancelInvite' }));
    expect(props.onCancelInvite).toHaveBeenCalledWith('invite-1');
  });

  it('keeps the invite when the confirmation is dismissed', () => {
    const props = renderTab();
    fireEvent.click(screen.getByRole('button', { name: 'common:actions.cancel' }));
    // The dialog's own Cancel dismisses without calling the API.
    const dialog = screen.getByRole('alertdialog');
    const cancel = dialog.querySelector('button') as HTMLElement;
    fireEvent.click(cancel);
    expect(props.onCancelInvite).not.toHaveBeenCalled();
  });

  it('truncates a long invite email but keeps it readable on hover', () => {
    renderTab();
    const email = screen.getByText('bob.with.a.very.long.address@example.com');
    expect(email).toHaveClass('truncate');
    expect(email).toHaveAttribute('title', 'bob.with.a.very.long.address@example.com');
    expect(email.parentElement).toHaveClass('min-w-0');
  });
});
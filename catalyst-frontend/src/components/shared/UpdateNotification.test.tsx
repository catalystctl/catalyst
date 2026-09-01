import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const mockUser = vi.hoisted(() => ({ current: undefined as any }));
vi.mock('../../stores/authStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../stores/authStore')>();
  return {
    ...actual,
    useAuthStore: ((selector: any) => selector({ user: mockUser.current })) as any,
  };
});

const mockUpdateCheck = vi.hoisted(() => ({ current: undefined as any }));
vi.mock('../../hooks/useUpdateCheck', () => ({
  useUpdateCheck: () => ({ data: mockUpdateCheck.current }),
}));

vi.mock('../admin/UpdateProgressModal', () => ({
  default: () => <div data-testid="progress-modal" />,
  consumePostUpdateReloadToast: vi.fn(() => false),
}));

import { consumePostUpdateReloadToast as mockConsumeUntyped } from '../admin/UpdateProgressModal';

const mockConsume = vi.mocked(mockConsumeUntyped);

import UpdateNotification from './UpdateNotification';

function mockUpdateData(overrides: Record<string, unknown> = {}) {
  mockUpdateCheck.current = {
    currentVersion: '1.28.2',
    latestVersion: '1.29.0',
    updateAvailable: true,
    isDocker: true,
    ...overrides,
  };
}

describe('UpdateNotification permission gating', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUser.current = undefined;
    mockUpdateCheck.current = undefined;
    mockConsume.mockReturnValue(false);
    localStorage.clear();
  });

  it('renders nothing for users without any permissions', () => {
    mockUser.current = { permissions: [] };
    mockUpdateData();
    const { container } = render(<UpdateNotification />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing for read-only admins (admin.read only)', () => {
    mockUser.current = { permissions: ['admin.read', 'server.read'] };
    mockUpdateData();
    const { container } = render(<UpdateNotification />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the banner for admins with admin.write', () => {
    mockUser.current = { permissions: ['admin.write'] };
    mockUpdateData();
    render(<UpdateNotification />);
    expect(screen.getByText(/update available/i)).toBeInTheDocument();
  });

  it('shows the banner for wildcard-permission users', () => {
    mockUser.current = { permissions: ['*'] };
    mockUpdateData();
    render(<UpdateNotification />);
    expect(screen.getByText(/update available/i)).toBeInTheDocument();
  });

  it('shows nothing when no update is available, even for admins', () => {
    mockUser.current = { permissions: ['admin.write'] };
    mockUpdateData({ updateAvailable: false });
    render(<UpdateNotification />);
    expect(screen.queryByText(/update available/i)).not.toBeInTheDocument();
  });

  it('shows nothing when not running in Docker (no in-place update possible)', () => {
    mockUser.current = { permissions: ['admin.write'] };
    mockUpdateData({ isDocker: false });
    render(<UpdateNotification />);
    expect(screen.queryByText(/update available/i)).not.toBeInTheDocument();
  });

  it('hides the banner when the version was dismissed', () => {
    mockUser.current = { permissions: ['admin.write'] };
    mockUpdateData();
    localStorage.setItem('catalyst-update-dismissed-v1.29.0', '1');
    render(<UpdateNotification />);
    expect(screen.queryByText(/update available/i)).not.toBeInTheDocument();
  });

  it('shows the completion toast after a post-update reload (persisted flag)', async () => {
    const notify = await import('../../utils/notify');
    const spy = vi.spyOn(notify, 'notifySuccess');
    mockConsume.mockReturnValue(true);
    mockUser.current = { permissions: ['admin.write'] };
    mockUpdateData({ updateAvailable: false });
    render(<UpdateNotification />);
    expect(spy).toHaveBeenCalledWith(expect.stringMatching(/update complete/i));
  });

  it('does not fire the completion toast without the persisted flag', async () => {
    const notify = await import('../../utils/notify');
    const spy = vi.spyOn(notify, 'notifySuccess');
    mockUser.current = { permissions: ['admin.write'] };
    mockUpdateData({ updateAvailable: false });
    render(<UpdateNotification />);
    expect(spy).not.toHaveBeenCalled();
  });
});

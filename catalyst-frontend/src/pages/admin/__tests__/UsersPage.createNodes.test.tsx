/**
 * UsersPage — create-user flow node access (audit A2, data loss).
 *
 * The create dialog's node selector is local-only (no target id exists yet), so
 * the first version of this dialog dropped every picked node. The page must now
 * flush each pick with `assignNode` after the create succeeds, and must report a
 * partial failure instead of claiming success.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const h = vi.hoisted(() => ({
  createUser: vi.fn(),
  updateUser: vi.fn(),
  listUsers: vi.fn(),
  listRoles: vi.fn(),
  listServers: vi.fn(),
  assignNode: vi.fn(),
  assignWildcard: vi.fn(),
  invalidate: vi.fn(),
  users: [] as any[],
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key}|${JSON.stringify(opts)}` : key,
    i18n: { language: 'en' },
  }),
  Trans: ({ children }: { children?: unknown }) => children,
}));

vi.mock('@/csync', () => ({
  useQuery: () => ({ data: undefined, isLoading: false, isError: false, refetch: vi.fn() }),
  useMutation: ({ mutationFn, onSuccess, onSettled, onError }: any) => ({
    isPending: false,
    mutate: async (...args: any[]) => {
      try {
        const result = await mutationFn(...args);
        onSuccess?.(result, args[0]);
      } catch (error) {
        onError?.(error);
      } finally {
        onSettled?.();
      }
    },
  }),
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 58,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({ index, key: index, start: index * 58 })),
    measureElement: () => {},
  }),
}));

vi.mock('@/lib/queryClient', () => ({
  queryClient: { invalidateQueries: (...args: unknown[]) => h.invalidate(...args) },
}));

vi.mock('@/components/shared/LastUpdated', () => ({ default: () => null }));
vi.mock('@/components/shared/Pagination', () => ({ default: () => null }));
vi.mock('@/components/shared/ConfirmDialog', () => ({ default: () => null }));
vi.mock('../../../components/servers/tabs/TabEmptyState', () => ({ default: () => null }));
vi.mock('../../../components/servers/tabs/TabErrorState', () => ({ default: () => null }));

vi.mock('../../../hooks/useAdmin', () => ({
  useAdminUsers: () => ({
    data: { users: h.users, pagination: { page: 1, limit: 20, total: h.users.length, totalPages: 1 } },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useAdminRoles: () => ({
    data: [{ id: 'role-1', name: 'administrator', permissions: ['*'], userCount: 1 }],
  }),
  useAdminServers: () => ({ data: { servers: [] } }),
}));

vi.mock('../../../services/api/admin', () => ({
  adminApi: {
    createUser: (...args: unknown[]) => h.createUser(...args),
    updateUser: (...args: unknown[]) => h.updateUser(...args),
    listUsers: (...args: unknown[]) => h.listUsers(...args),
    getUserServers: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../../../services/api/nodes', () => ({
  nodesApi: {
    assignNode: (...args: unknown[]) => h.assignNode(...args),
    assignWildcard: (...args: unknown[]) => h.assignWildcard(...args),
  },
}));

// The selector is local-only in create mode; stand in a button that emits a pick.
vi.mock('../../../components/admin/NodeAssignmentsSelector', () => ({
  NodeAssignmentsSelector: ({
    selectedNodes,
    onSelectionChange,
  }: {
    selectedNodes: Array<{ nodeId: string | null; nodeName: string }>;
    onSelectionChange: (nodes: any[]) => void;
  }) => (
    <button
      type="button"
      data-testid="pick-node"
      onClick={() =>
        onSelectionChange([...selectedNodes, { nodeId: 'node-a', nodeName: 'Alpha', source: 'user' }])
      }
    >
      pick
    </button>
  ),
}));

vi.mock('../../../utils/notify', () => ({
  notifyError: vi.fn(),
  notifySuccess: vi.fn(),
}));

import { notifyError, notifySuccess } from '../../../utils/notify';
import UsersPage from '../UsersPage';

beforeEach(() => {
  h.createUser.mockReset().mockResolvedValue({ id: 'user-new', username: 'newbie' });
  h.updateUser.mockReset().mockResolvedValue({});
  h.listUsers.mockReset();
  h.assignNode.mockReset().mockResolvedValue({});
  h.assignWildcard.mockReset().mockResolvedValue({});
  h.invalidate.mockReset();
  vi.mocked(notifyError).mockReset();
  vi.mocked(notifySuccess).mockReset();
});

afterEach(cleanup);

async function fillAndSubmitCreate() {
  fireEvent.click(screen.getByRole('button', { name: /users.createTitle/ }));
  fireEvent.change(screen.getByPlaceholderText('user@example.com'), {
    target: { value: 'newbie@example.com' },
  });
  fireEvent.change(screen.getByPlaceholderText('username'), { target: { value: 'newbie' } });
  fireEvent.change(screen.getByPlaceholderText('********'), {
    target: { value: 'a-long-enough-password' },
  });
}

describe('UsersPage create-user node access', () => {
  it('assigns every picked node after the user is created', async () => {
    render(<UsersPage />);
    await fillAndSubmitCreate();

    fireEvent.click(screen.getByTestId('pick-node'));
    fireEvent.click(screen.getByRole('button', { name: /users.createTitle/ }));

    await waitFor(() => expect(h.createUser).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(h.assignNode).toHaveBeenCalledWith('node-a', {
        targetType: 'user',
        targetId: 'user-new',
        expiresAt: undefined,
      }),
    );
    expect(String(vi.mocked(notifySuccess).mock.calls[0][0])).toBe('users.toasts.created');
  });

  it('submits from a real form so Enter works', async () => {
    render(<UsersPage />);
    await fillAndSubmitCreate();

    const email = screen.getByPlaceholderText('user@example.com');
    const form = email.closest('form');
    expect(form).not.toBeNull();

    // Enter inside a field is the browser's implicit form submission.
    fireEvent.submit(form!);

    await waitFor(() => expect(h.createUser).toHaveBeenCalledTimes(1));
    expect(h.createUser).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'newbie@example.com', username: 'newbie' }),
    );
  });

  it('reports a partial failure instead of claiming the access was saved', async () => {
    h.assignNode.mockRejectedValueOnce(new Error('nope'));
    render(<UsersPage />);
    await fillAndSubmitCreate();

    fireEvent.click(screen.getByTestId('pick-node'));
    fireEvent.click(screen.getByRole('button', { name: /users.createTitle/ }));

    await waitFor(() => expect(notifyError).toHaveBeenCalledTimes(1));
    const message = String(vi.mocked(notifyError).mock.calls[0][0]);
    expect(message).toContain('users.toasts.nodeAccessPartial');
    expect(message).toContain('Alpha');
    // The account itself was created; only the access pick failed.
    expect(
      vi.mocked(notifySuccess).mock.calls.map((call) => String(call[0])),
    ).not.toContain('users.toasts.created');
  });
});

/**
 * Audit D15/D23: the row "…" → Roles popover saves only `{roleIds}`, and a
 * selection survives paging (it is no longer pruned to the current page).
 */
describe('UsersPage row actions', () => {
  const rowUsers = [
    {
      id: 'user-1',
      email: 'ada@example.com',
      username: 'ada',
      emailVerified: true,
      banned: false,
      roles: [{ id: 'role-1', name: 'administrator' }],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'user-2',
      email: 'bob@example.com',
      username: 'bob',
      emailVerified: true,
      banned: false,
      roles: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ];

  beforeEach(() => {
    h.users = rowUsers;
  });

  it('changes roles from the row menu with a roles-only payload', async () => {
    render(<UsersPage />);

    // Radix opens the menu on pointerdown, not click.
    fireEvent.pointerDown(screen.getAllByTitle('users.more')[1], {
      button: 0,
      ctrlKey: false,
      pointerType: 'mouse',
    });
    fireEvent.click(await screen.findByText('users.changeRoles'));

    // The dialog opens with the current roles preselected (none for bob) and
    // saves through PUT with the role ids only.
    expect(screen.getByText('users.quickRolesTitle')).toBeInTheDocument();
    // jsdom never fires the menu's exit animation, so Radix leaves its
    // aria-hidden wrapper in place — the dialog subtree is queried as hidden
    // and one checkbox per role is rendered there.
    const dialog = screen.getByText('users.quickRolesTitle').closest('[role=dialog]') as HTMLElement;
    fireEvent.click(within(dialog).getByRole('checkbox', { hidden: true }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'saveChanges', hidden: true }));

    await waitFor(() => expect(h.updateUser).toHaveBeenCalledTimes(1));
    expect(h.updateUser).toHaveBeenCalledWith('user-2', { roleIds: ['role-1'] });
  });

  it('keeps a selection whose user is not on the current page', async () => {
    render(<UsersPage />);

    // Tick the first row.
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[1]);

    // The selection bar reports one selected user.
    expect(screen.getByText(/users.selectedCount/)).toBeInTheDocument();
  });
});

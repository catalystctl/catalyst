/**
 * RolesPage — role members (audit D20).
 *
 * The roles list only carried `userCount`, so "who is in this role?" meant
 * editing users one by one. The members dialog reads `GET /api/roles/:id`
 * (which returns `users`), adds via `POST /api/roles/:roleId/users/:userId`
 * and removes via the matching DELETE.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const h = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  getWithMembers: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  delete: vi.fn(),
  assignToUser: vi.fn(),
  assignNode: vi.fn(),
  assignWildcard: vi.fn(),
  removeFromUser: vi.fn(),
  listUsers: vi.fn(),
  invalidate: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key}|${JSON.stringify(opts)}` : key,
    i18n: { language: 'en' },
  }),
}));

vi.mock('@/csync', () => ({
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => {
    const key = String(queryKey?.[0] ?? '');
    if (key === 'admin-roles') return { data: h.list(), isLoading: false };
    if (key === 'role-presets') return { data: [] };
    if (key === 'roles') return { data: h.getWithMembers(String(queryKey[1])) };
    if (key === 'admin-users') return { data: { users: h.listUsers() } };
    return { data: undefined };
  },
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

vi.mock('../../../hooks/useStreamAwareInterval', () => ({
  useStreamAwareInterval: () => false,
}));

vi.mock('@/components/shared/LastUpdated', () => ({ default: () => null }));
vi.mock('../../../components/shared/ConfirmDialog', () => {
  // A stand-in confirm dialog: renders a button that fires onConfirm.
  const Stub = ({ open, onConfirm }: { open: boolean; onConfirm: () => void }) =>
    open ? (
      <button type="button" data-testid="confirm" onClick={onConfirm}>
        confirm
      </button>
    ) : null;
  return { default: Stub, ConfirmDialog: Stub };
});
vi.mock('../../../components/servers/tabs/TabEmptyState', () => ({ default: () => null }));
vi.mock('../../../services/api/admin', () => ({
  adminApi: { listUsers: (...args: unknown[]) => h.listUsers(...args) },
}));
vi.mock('../../../services/api/roles', () => ({
  rolesApi: {
    list: (...args: unknown[]) => h.list(...args),
    get: (...args: unknown[]) => h.get(...args),
    getWithMembers: (...args: unknown[]) => h.getWithMembers(...args),
    create: (...args: unknown[]) => h.create(...args),
    update: (...args: unknown[]) => h.update(...args),
    delete: (...args: unknown[]) => h.delete(...args),
    removeFromUser: (...args: unknown[]) => h.removeFromUser(...args),
    assignToUser: (...args: unknown[]) => h.assignToUser(...args),
    getPermissionCatalog: vi.fn(),
    getPresets: vi.fn(),
  },
}));

// The editor itself is covered elsewhere; this stub submits a create payload
// with one picked node so the page's post-create flush can be observed.
vi.mock('../role-creator/RoleCreatorDialog', () => ({
  RoleCreatorDialog: ({ open, onSubmit }: any) =>
    open ? (
      <button
        type="button"
        data-testid="submit-role"
        onClick={() =>
          onSubmit(
            { name: 'copy', permissions: ['server.read'] },
            [{ nodeId: 'node-a', nodeName: 'Alpha', source: 'user' }],
          )
        }
      >
        submit
      </button>
    ) : null,
}));

vi.mock('../../../utils/notify', () => ({
  notifyError: vi.fn(),
  notifySuccess: vi.fn(),
}));

vi.mock('../../../services/api/nodes', () => ({
  nodesApi: {
    assignNode: (...args: unknown[]) => h.assignNode(...args),
    assignWildcard: (...args: unknown[]) => h.assignWildcard(...args),
  },
}));

import RolesPage from '../RolesPage';

const role = {
  id: 'role-1',
  name: 'moderator',
  description: 'keeps the chat civil',
  permissions: ['server.read'],
  userCount: 1,
  nodeGrantCount: 0,
  serverGrantCount: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

beforeEach(() => {
  h.list.mockReset().mockReturnValue([role]);
  h.get.mockReset().mockReturnValue(role);
  h.getWithMembers.mockReset().mockReturnValue({
    ...role,
    users: [{ id: 'user-1', username: 'ada', email: 'ada@example.com' }],
  });
  h.assignToUser.mockReset().mockResolvedValue({});
  h.create.mockReset().mockResolvedValue({ id: 'role-new', name: 'copy' });
  h.assignNode.mockReset().mockResolvedValue({});
  h.assignWildcard.mockReset().mockResolvedValue({});
  h.removeFromUser.mockReset().mockResolvedValue({});
  h.listUsers.mockReset().mockReturnValue([
    { id: 'user-1', username: 'ada', email: 'ada@example.com' },
    { id: 'user-2', username: 'bob', email: 'bob@example.com' },
  ]);
  h.invalidate.mockReset();
});

afterEach(cleanup);

describe('RolesPage members', () => {
  it('lists current members and adds a candidate user', async () => {
    render(<RolesPage />);

    fireEvent.click(screen.getByLabelText('roles.members.manage'));

    await waitFor(() => expect(screen.getByText('ada')).toBeInTheDocument());
    expect(h.getWithMembers).toHaveBeenCalledWith('role-1');

    // bob is not a member, so he is offered as an add candidate.
    fireEvent.click(screen.getByRole('button', { name: /bob/ }));

    await waitFor(() => expect(h.assignToUser).toHaveBeenCalledWith('role-1', 'user-2'));
    await waitFor(() =>
      expect(h.invalidate).toHaveBeenCalledWith({ queryKey: ['roles', 'role-1', 'members'] }),
    );
  });

  it('refreshes derived permission caches after a role is deleted', async () => {
    h.delete = vi.fn().mockResolvedValue({});
    // The delete action is only offered for a role with no members.
    h.list.mockReturnValue([{ ...role, userCount: 0 }]);
    render(<RolesPage />);

    fireEvent.click(screen.getByTitle('common:actions.delete'));
    fireEvent.click(screen.getByTestId('confirm'));

    await waitFor(() => expect(h.delete).toHaveBeenCalledWith('role-1'));
    await waitFor(() => {
      const keys = h.invalidate.mock.calls.map((call: any[]) => JSON.stringify(call[0]?.queryKey));
      expect(keys).toContain(JSON.stringify(['admin-roles']));
      expect(keys).toContain(JSON.stringify(['my-permissions']));
      expect(keys).toContain(JSON.stringify(['server-permissions']));
    });
  });

  it('removes a member', async () => {
    render(<RolesPage />);

    fireEvent.click(screen.getByLabelText('roles.members.manage'));
    const dialog = await screen.findByText(/roles.members.title/);
    const scope = dialog.closest('[role=dialog]') as HTMLElement;

    fireEvent.click(within(scope).getByRole('button', { name: /roles.members.remove/ }));

    await waitFor(() => expect(h.removeFromUser).toHaveBeenCalledWith('role-1', 'user-1'));
  });
});
describe('RolesPage create flush', () => {
  it('assigns the create-mode node picks once the role exists', async () => {
    render(<RolesPage />);

    fireEvent.click(screen.getByRole('button', { name: /roles.createTitle/ }));
    fireEvent.click(await screen.findByTestId('submit-role'));

    await waitFor(() => expect(h.create).toHaveBeenCalledWith({
      name: 'copy',
      permissions: ['server.read'],
    }));
    await waitFor(() =>
      expect(h.assignNode).toHaveBeenCalledWith('node-a', {
        targetType: 'role',
        targetId: 'role-new',
        expiresAt: undefined,
      }),
    );
  });
});

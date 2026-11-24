/**
 * NodeAssignmentsSelector — expiry editing (audit D21).
 *
 * Changing an expiry used to be "delete the assignment, create it again", which
 * lost `assignedAt`/`assignedBy` and raced with concurrent readers. The selector
 * must now PATCH the single assignment in place, and must be local-only in
 * create mode (nothing exists yet to patch).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({
  getAssignments: vi.fn(),
  updateAssignmentExpiry: vi.fn(),
  assignNode: vi.fn(),
  removeAssignment: vi.fn(),
  list: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, opts?: Record<string, unknown>) =>
    opts ? `${key}|${JSON.stringify(opts)}` : key }),
}));

vi.mock('@/csync', () => ({
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => {
    const key = String(queryKey?.[0] ?? '');
    if (key === 'nodes') {
      return {
        data: [
          { id: 'node-a', name: 'Alpha', location: { name: 'EU' } },
          { id: 'node-b', name: 'Bravo', location: { name: 'US' } },
        ],
        isLoading: false,
      };
    }
    return { data: { data: [], hasWildcard: false }, isLoading: false };
  },
}));

vi.mock('@/lib/queryClient', () => ({
  queryClient: { invalidateQueries: vi.fn() },
}));

vi.mock('@/services/api/systemErrors', () => ({ reportSystemError: vi.fn() }));
vi.mock('@/i18n/format', () => ({ formatDate: (value: string) => value }));

vi.mock('../../../services/api/nodes', () => ({
  nodesApi: {
    list: (...args: unknown[]) => h.list(...args),
    getAssignments: (...args: unknown[]) => h.getAssignments(...args),
    updateAssignmentExpiry: (...args: unknown[]) => h.updateAssignmentExpiry(...args),
    assignNode: (...args: unknown[]) => h.assignNode(...args),
    removeAssignment: (...args: unknown[]) => h.removeAssignment(...args),
    assignWildcard: vi.fn(),
    removeWildcard: vi.fn(),
  },
}));

vi.mock('../../../utils/notify', () => ({
  notifyError: vi.fn(),
  notifySuccess: vi.fn(),
}));

import { notifyError, notifySuccess } from '../../../utils/notify';
import { NodeAssignmentsSelector } from '../NodeAssignmentsSelector';

const selected = [
  { nodeId: 'node-a', nodeName: 'Alpha', source: 'user' as const },
];

beforeEach(() => {
  h.getAssignments.mockReset().mockResolvedValue([
    { id: 'assign-1', userId: 'user-1', nodeId: 'node-a', assignedBy: 'admin', assignedAt: new Date() },
  ]);
  h.updateAssignmentExpiry.mockReset().mockResolvedValue({});
  h.assignNode.mockReset().mockResolvedValue({});
  h.removeAssignment.mockReset().mockResolvedValue({});
  h.list.mockReset().mockResolvedValue([]);
  vi.mocked(notifySuccess).mockReset();
  vi.mocked(notifyError).mockReset();
});

afterEach(cleanup);

function renderSelector(props: Partial<React.ComponentProps<typeof NodeAssignmentsSelector>> = {}) {
  const onSelectionChange = vi.fn();
  render(
    <NodeAssignmentsSelector
      userId="user-1"
      selectedNodes={selected}
      onSelectionChange={onSelectionChange}
      {...props}
    />,
  );
  return { onSelectionChange };
}

describe('NodeAssignmentsSelector expiry editing', () => {
  it('PATCHes the assignment in place instead of remove + re-assign', async () => {
    renderSelector();

    fireEvent.click(screen.getByText('nodeAssignments.setExpiration'));
    // The dialog renders; pick a date and save.
    const input = screen.getByLabelText('nodeAssignments.dialog.expiresAt');
    fireEvent.change(input, { target: { value: '2027-05-01T10:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'common:actions.save' }));

    await waitFor(() => expect(h.updateAssignmentExpiry).toHaveBeenCalledTimes(1));

    const [nodeId, assignmentId, expiresAt] = h.updateAssignmentExpiry.mock.calls[0];
    expect(nodeId).toBe('node-a');
    expect(assignmentId).toBe('assign-1');
    expect(expiresAt).toBe(new Date('2027-05-01T10:00').toISOString());
    // The old delete-then-recreate path must be gone.
    expect(h.removeAssignment).not.toHaveBeenCalled();
    expect(h.assignNode).not.toHaveBeenCalled();
    expect(notifySuccess).toHaveBeenCalledWith('nodeAssignments.toast.expirationUpdated');
  });

  it('reports a failed expiry change and keeps the assignment', async () => {
    h.updateAssignmentExpiry.mockRejectedValueOnce(new Error('denied'));
    renderSelector();

    fireEvent.click(screen.getByText('nodeAssignments.setExpiration'));
    fireEvent.change(screen.getByLabelText('nodeAssignments.dialog.expiresAt'), {
      target: { value: '2027-05-01T10:00' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'common:actions.save' }));

    await waitFor(() => expect(notifyError).toHaveBeenCalledTimes(1));
    expect(h.removeAssignment).not.toHaveBeenCalled();
  });

  it('stages the expiry locally in create mode without any API call', async () => {
    const { onSelectionChange } = renderSelector({ userId: undefined, selectedNodes: selected });

    fireEvent.click(screen.getByText('nodeAssignments.setExpiration'));
    fireEvent.change(screen.getByLabelText('nodeAssignments.dialog.expiresAt'), {
      target: { value: '2027-05-01T10:00' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'common:actions.save' }));

    await waitFor(() => expect(onSelectionChange).toHaveBeenCalled());
    expect(h.updateAssignmentExpiry).not.toHaveBeenCalled();
    expect(h.getAssignments).not.toHaveBeenCalled();
  });
});

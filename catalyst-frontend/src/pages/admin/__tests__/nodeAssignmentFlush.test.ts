import { beforeEach, describe, expect, it, vi } from 'vitest';

const assignNode = vi.fn();
const assignWildcard = vi.fn();

vi.mock('../../../services/api/nodes', () => ({
  nodesApi: {
    assignNode: (...args: unknown[]) => assignNode(...args),
    assignWildcard: (...args: unknown[]) => assignWildcard(...args),
  },
}));

import { flushNodeAssignments } from '../nodeAssignmentFlush';

const node = (id: string, name: string, expiresAt?: string) => ({
  nodeId: id,
  nodeName: name,
  source: 'user' as const,
  ...(expiresAt ? { expiresAt } : {}),
});

beforeEach(() => {
  assignNode.mockReset();
  assignWildcard.mockReset();
  assignNode.mockResolvedValue({});
  assignWildcard.mockResolvedValue({});
});

describe('flushNodeAssignments', () => {
  it('assigns every picked node to the freshly created target', async () => {
    const result = await flushNodeAssignments(
      { targetType: 'user', targetId: 'user-1' },
      [node('node-a', 'Alpha'), node('node-b', 'Bravo', '2027-01-01T00:00:00.000Z')],
    );

    expect(assignNode).toHaveBeenCalledTimes(2);
    expect(assignNode).toHaveBeenNthCalledWith(1, 'node-a', {
      targetType: 'user',
      targetId: 'user-1',
      expiresAt: undefined,
    });
    expect(assignNode).toHaveBeenNthCalledWith(2, 'node-b', {
      targetType: 'user',
      targetId: 'user-1',
      expiresAt: '2027-01-01T00:00:00.000Z',
    });
    expect(result).toEqual({
      assigned: ['Alpha', 'Bravo'],
      failed: [],
      wildcard: false,
      wildcardFailed: false,
    });
  });

  it('keeps going after a failure and reports only the nodes that failed', async () => {
    assignNode
      .mockRejectedValueOnce(new Error('nope'))
      .mockResolvedValueOnce({});

    const result = await flushNodeAssignments(
      { targetType: 'role', targetId: 'role-1' },
      [node('node-a', 'Alpha'), node('node-b', 'Bravo')],
    );

    expect(assignNode).toHaveBeenCalledTimes(2);
    expect(result.assigned).toEqual(['Bravo']);
    expect(result.failed).toEqual(['Alpha']);
  });

  it('uses the wildcard endpoint and skips per-node calls when all nodes is picked', async () => {
    const result = await flushNodeAssignments(
      { targetType: 'user', targetId: 'user-2' },
      [{ nodeId: null, nodeName: 'All nodes', isWildcard: true }],
    );

    expect(assignWildcard).toHaveBeenCalledWith({
      targetType: 'user',
      targetId: 'user-2',
      expiresAt: undefined,
    });
    expect(assignNode).not.toHaveBeenCalled();
    expect(result.wildcard).toBe(true);
    expect(result.wildcardFailed).toBe(false);
  });

  it('reports a failed wildcard separately from failed nodes', async () => {
    assignWildcard.mockRejectedValueOnce(new Error('denied'));

    const result = await flushNodeAssignments(
      { targetType: 'user', targetId: 'user-3' },
      [{ nodeId: null, nodeName: 'All nodes', isWildcard: true }],
    );

    expect(result.wildcard).toBe(false);
    expect(result.wildcardFailed).toBe(true);
  });

  it('does nothing when no node was picked', async () => {
    const result = await flushNodeAssignments({ targetType: 'user', targetId: 'user-4' }, []);

    expect(assignNode).not.toHaveBeenCalled();
    expect(assignWildcard).not.toHaveBeenCalled();
    expect(result).toEqual({ assigned: [], failed: [], wildcard: false, wildcardFailed: false });
  });
});

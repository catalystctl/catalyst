import { nodesApi } from '../../services/api/nodes';
import type { NodeAssignmentWithExpiration } from '../../components/admin/NodeAssignmentsSelector';

export type NodeFlushTarget = {
  targetType: 'user' | 'role';
  targetId: string;
};

export type NodeFlushResult = {
  /** Node names that were persisted. */
  assigned: string[];
  /** Node names whose assignment call failed. */
  failed: string[];
  /** True when the wildcard ("all nodes") reach was persisted. */
  wildcard: boolean;
  /** True when a wildcard assignment call failed. */
  wildcardFailed: boolean;
};

/**
 * Persist the nodes picked in the create dialog's `NodeAssignmentsSelector`.
 *
 * The selector is local-only until its target exists, so creating a user or a
 * role used to drop every picked node silently (audit A2). Both create flows
 * call this right after the create succeeds. Each node is a separate request so
 * one failure does not discard the rest; the caller reports the partial result.
 */
export async function flushNodeAssignments(
  target: NodeFlushTarget,
  selection: NodeAssignmentWithExpiration[],
): Promise<NodeFlushResult> {
  const result: NodeFlushResult = {
    assigned: [],
    failed: [],
    wildcard: false,
    wildcardFailed: false,
  };

  const wantsWildcard = selection.some((node) => node.isWildcard || node.nodeId === null);
  const nodes = selection.filter(
    (node): node is NodeAssignmentWithExpiration & { nodeId: string } =>
      !node.isWildcard && typeof node.nodeId === 'string',
  );

  if (wantsWildcard) {
    const wildcard = selection.find((node) => node.isWildcard || node.nodeId === null);
    try {
      await nodesApi.assignWildcard({
        targetType: target.targetType,
        targetId: target.targetId,
        expiresAt: wildcard?.expiresAt,
      });
      result.wildcard = true;
    } catch {
      result.wildcardFailed = true;
    }
  }

  // A wildcard assignment is exclusive on the backend (it drops the specific
  // rows), so only flush individual nodes when the wildcard was not requested.
  if (!wantsWildcard) {
    for (const node of nodes) {
      try {
        await nodesApi.assignNode(node.nodeId, {
          targetType: target.targetType,
          targetId: target.targetId,
          expiresAt: node.expiresAt,
        });
        result.assigned.push(node.nodeName);
      } catch {
        result.failed.push(node.nodeName);
      }
    }
  }

  return result;
}

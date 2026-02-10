import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { nodesApi } from '../../services/api/nodes';
import { notifyError, notifySuccess } from '../../utils/notify';

export type NodeAssignmentWithExpiration = {
  nodeId: string;
  nodeName: string;
  expiresAt?: string;
  source?: 'user' | 'role'; // For users - shows inherited vs direct
  roleName?: string;
};

type Props = {
  roleId?: string; // If editing a role
  userId?: string; // If editing a user
  selectedNodes: NodeAssignmentWithExpiration[];
  onSelectionChange: (nodes: NodeAssignmentWithExpiration[]) => void;
  disabled?: boolean;
  label?: string;
};

export function NodeAssignmentsSelector({
  roleId,
  userId,
  selectedNodes,
  onSelectionChange,
  disabled = false,
  label = 'Node Access',
}: Props) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [expirationNodeId, setExpirationNodeId] = useState<string | null>(null);
  const [expirationDate, setExpirationDate] = useState('');

  // Fetch available nodes
  const { data: nodes = [], isLoading: nodesLoading } = useQuery({
    queryKey: ['nodes'],
    queryFn: () => nodesApi.list(),
  });

  // Fetch current assignments for roles
  const { data: roleAssignments = [], isLoading: roleAssignmentsLoading } = useQuery({
    queryKey: ['roles', roleId, 'nodes'],
    queryFn: async () => {
      if (!roleId) return [];
      const response = await fetch(`/api/roles/${roleId}/nodes`, {
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await response.json();
      return data.data || [];
    },
    enabled: !!roleId,
  });

  // Fetch current assignments for users
  const { data: userAssignments = [], isLoading: userAssignmentsLoading } = useQuery({
    queryKey: ['users', userId, 'nodes'],
    queryFn: async () => {
      if (!userId) return [];
      const response = await fetch(`/api/roles/users/${userId}/nodes`, {
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await response.json();
      return data.data || [];
    },
    enabled: !!userId,
  });

  // Initialize selections from fetched data
  const assignments = userId ? userAssignments : roleAssignments;

  // Toggle node selection
  const toggleNode = (nodeId: string, nodeName: string) => {
    if (disabled) return;

    const existingIndex = selectedNodes.findIndex(n => n.nodeId === nodeId);
    const newSelection = [...selectedNodes];

    if (existingIndex >= 0) {
      // Remove node
      newSelection.splice(existingIndex, 1);

      // Also remove from server
      removeNodeAssignment(nodeId);
    } else {
      // Add node (without expiration initially, user can set it)
      newSelection.push({ nodeId, nodeName });
      addNodeAssignment(nodeId);
    }

    onSelectionChange(newSelection);
  };

  // Add node assignment to server
  const addNodeAssignment = async (nodeId: string) => {
    try {
      const targetType = userId ? 'user' : 'role';
      const targetId = userId || roleId;

      await nodesApi.assignNode(nodeId, {
        targetType,
        targetId: targetId!,
      });

      notifySuccess('Node assigned');
      queryClient.invalidateQueries({ queryKey: ['nodes', nodeId, 'assignments'] });
    } catch (error: any) {
      notifyError(error?.response?.data?.error || 'Failed to assign node');
      // Revert the local change
      onSelectionChange(selectedNodes);
    }
  };

  // Remove node assignment from server
  const removeNodeAssignment = async (nodeId: string) => {
    try {
      const nodeAssignments = await nodesApi.getAssignments(nodeId);
      const targetId = userId || roleId;
      const targetType = userId ? 'user' : 'role';

      const assignment = nodeAssignments.find(a =>
        targetType === 'user' ? a.userId === targetId : a.roleId === targetId
      );

      if (assignment) {
        await nodesApi.removeAssignment(nodeId, assignment.id);
        notifySuccess('Node unassigned');
        queryClient.invalidateQueries({ queryKey: ['nodes', nodeId, 'assignments'] });
      }
    } catch (error: any) {
      notifyError(error?.response?.data?.error || 'Failed to unassign node');
      // Revert the local change
      onSelectionChange(selectedNodes);
    }
  };

  // Update expiration date for a node
  const updateExpiration = async (nodeId: string, expiresAt: string) => {
    if (disabled) return;

    // Remove old assignment and create new one with expiration
    const targetId = userId || roleId;
    const targetType = userId ? 'user' : 'role';

    try {
      // First remove old assignment
      const nodeAssignments = await nodesApi.getAssignments(nodeId);
      const assignment = nodeAssignments.find(a =>
        targetType === 'user' ? a.userId === targetId : a.roleId === targetId
      );

      if (assignment) {
        await nodesApi.removeAssignment(nodeId, assignment.id);
      }

      // Create new assignment with expiration
      await nodesApi.assignNode(nodeId, {
        targetType,
        targetId: targetId!,
        expiresAt: expiresAt || undefined,
      });

      // Update local state
      const newSelection = selectedNodes.map(n =>
        n.nodeId === nodeId ? { ...n, expiresAt: expiresAt || undefined } : n
      );
      onSelectionChange(newSelection);

      setExpirationNodeId(null);
      setExpirationDate('');
      notifySuccess('Expiration updated');
    } catch (error: any) {
      notifyError(error?.response?.data?.error || 'Failed to update expiration');
    }
  };

  // Filter nodes by search
  const filteredNodes = nodes.filter(node =>
    node.name.toLowerCase().includes(search.toLowerCase()) ||
    node.location?.name.toLowerCase().includes(search.toLowerCase())
  );

  // Separate inherited (for users) and direct assignments
  const directAssignments = selectedNodes.filter(n => n.source === 'user' || !n.source);
  const inheritedAssignments = selectedNodes.filter(n => n.source === 'role');

  const isLoading = nodesLoading || roleAssignmentsLoading || userAssignmentsLoading;

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900/60">
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          {label} ({selectedNodes.length})
        </div>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search nodes..."
          className="w-48 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400"
        />
      </div>

      {isLoading ? (
        <div className="py-4 text-center text-sm text-slate-500 dark:text-slate-400">
          Loading nodes...
        </div>
      ) : (
        <>
          {/* Selected nodes */}
          {selectedNodes.length > 0 && (
            <div className="mb-3 space-y-2">
              {inheritedAssignments.length > 0 && (
                <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">
                  Inherited from roles
                </div>
              )}
              {inheritedAssignments.map(node => (
                <div
                  key={node.nodeId}
                  className="flex items-center justify-between rounded-md border border-purple-200 bg-purple-50 px-2 py-1.5 dark:border-purple-500/30 dark:bg-purple-500/10"
                >
                  <div className="flex items-center gap-2">
                    <svg className="h-4 w-4 text-purple-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span className="text-xs font-medium text-slate-900 dark:text-slate-200">{node.nodeName}</span>
                    {node.roleName && (
                      <span className="text-[10px] text-purple-600 dark:text-purple-400">
                        via {node.roleName}
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] text-slate-500 dark:text-slate-400">
                    {node.expiresAt ? `Expires: ${new Date(node.expiresAt).toLocaleDateString()}` : 'No expiration'}
                  </span>
                </div>
              ))}
              {directAssignments.map(node => (
                <div
                  key={node.nodeId}
                  className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-2 py-1.5 dark:border-slate-800 dark:bg-slate-950"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-slate-900 dark:text-slate-200">{node.nodeName}</span>
                    {node.expiresAt && (
                      <span className="text-[10px] text-slate-500 dark:text-slate-400">
                        Expires: {new Date(node.expiresAt).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                  {!disabled && (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => {
                          setExpirationNodeId(node.nodeId);
                          setExpirationDate(node.expiresAt || '');
                        }}
                        className="rounded px-1.5 py-0.5 text-[10px] text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-300"
                      >
                        Set Expiration
                      </button>
                      <button
                        onClick={() => toggleNode(node.nodeId, node.nodeName)}
                        className="rounded p-0.5 text-slate-400 transition-colors hover:bg-rose-100 hover:text-rose-600 dark:hover:bg-rose-900/20 dark:hover:text-rose-400"
                      >
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Available nodes */}
          <div className="max-h-36 overflow-y-auto pr-1">
            {filteredNodes.length === 0 ? (
              <div className="py-2 text-center text-xs text-slate-500 dark:text-slate-400">
                No nodes found
              </div>
            ) : (
              filteredNodes.map((node) => {
                const isSelected = selectedNodes.some(n => n.nodeId === node.id);
                const isInherited = inheritedAssignments.some(n => n.nodeId === node.id);

                return (
                  <label
                    key={node.id}
                    className={`flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs transition-all ${
                      isSelected && isInherited
                        ? 'border-purple-200 bg-purple-50 dark:border-purple-500/30 dark:bg-purple-500/10 cursor-default'
                        : isSelected
                        ? 'border-primary-200 bg-primary-50 dark:border-primary-500/30 dark:bg-primary-500/10 cursor-pointer'
                        : 'border-slate-200 bg-white hover:border-primary-500 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-950 dark:hover:border-primary-500/30 dark:hover:bg-slate-900 cursor-pointer'
                    }`}
                  >
                    {isInherited ? (
                      <svg className="h-4 w-4 text-purple-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      <input
                        type="checkbox"
                        checked={isSelected}
                        disabled={disabled || isInherited}
                        onChange={() => toggleNode(node.id, node.name)}
                        className="h-4 w-4 rounded border-slate-300 bg-white text-primary-600 focus:ring-2 focus:ring-primary-500 dark:border-slate-700 dark:bg-slate-900 dark:text-primary-400 disabled:opacity-50"
                      />
                    )}
                    <span className="flex-1 font-medium text-slate-900 dark:text-slate-200">{node.name}</span>
                    <span className="text-[10px] text-slate-500 dark:text-slate-400">{node.location?.name}</span>
                  </label>
                );
              })
            )}
          </div>

          {/* Expiration date modal */}
          {expirationNodeId && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-white dark:bg-slate-950/60 px-4 backdrop-blur-sm">
              <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-4 shadow-surface-light dark:shadow-surface-dark dark:border-slate-800 dark:bg-slate-900">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-3">
                  Set Expiration for {nodes.find(n => n.id === expirationNodeId)?.name}
                </h3>
                <input
                  type="datetime-local"
                  value={expirationDate}
                  onChange={(e) => setExpirationDate(e.target.value)}
                  min={new Date().toISOString().slice(0, 16)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
                />
                <div className="mt-4 flex justify-end gap-2">
                  <button
                    onClick={() => updateExpiration(expirationNodeId, expirationDate)}
                    className="rounded-md bg-primary-600 px-3 py-1.5 text-xs font-semibold text-white shadow-lg shadow-primary-500/20 transition-all duration-300 hover:bg-primary-500"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => {
                      setExpirationNodeId(null);
                      setExpirationDate('');
                    }}
                    className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 transition-all duration-300 hover:border-primary-500 hover:text-slate-900 dark:border-slate-800 dark:text-slate-300 dark:hover:border-primary-500/30"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

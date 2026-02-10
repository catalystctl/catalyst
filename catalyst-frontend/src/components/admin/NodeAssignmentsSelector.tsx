import { useState, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { nodesApi } from '../../services/api/nodes';
import { notifyError, notifySuccess } from '../../utils/notify';

export type NodeAssignmentWithExpiration = {
  nodeId: string | null; // null for wildcard (*)
  nodeName: string;
  expiresAt?: string;
  source?: 'user' | 'role'; // For users - shows inherited vs direct
  roleName?: string;
  isWildcard?: boolean; // true if this is a wildcard assignment
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
  const [hasWildcard, setHasWildcard] = useState(false);

  // Check for wildcard assignment
  useEffect(() => {
    const wildcard = selectedNodes.some(n => n.isWildcard || n.nodeId === null);
    setHasWildcard(wildcard);
  }, [selectedNodes]);

  // Fetch available nodes
  const { data: nodes = [], isLoading: nodesLoading } = useQuery({
    queryKey: ['nodes'],
    queryFn: () => nodesApi.list(),
  });

  // Fetch current assignments for roles
  const { data: roleAssignmentsData, isLoading: roleAssignmentsLoading } = useQuery({
    queryKey: ['roles', roleId, 'nodes'],
    queryFn: async () => {
      if (!roleId) return { data: [], hasWildcard: false };
      const response = await fetch(`/api/roles/${roleId}/nodes`, {
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await response.json();
      return { data: data.data || [], hasWildcard: data.hasWildcard || false };
    },
    enabled: !!roleId,
  });

  // Fetch current assignments for users
  const { data: userAssignmentsData, isLoading: userAssignmentsLoading } = useQuery({
    queryKey: ['users', userId, 'nodes'],
    queryFn: async () => {
      if (!userId) return { data: [], hasWildcard: false };
      const response = await fetch(`/api/roles/users/${userId}/nodes`, {
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await response.json();
      return { data: data.data || [], hasWildcard: data.hasWildcard || false };
    },
    enabled: !!userId,
  });

  // Initialize selections from fetched data
  const assignmentsData = userId ? userAssignmentsData : roleAssignmentsData;
  const assignments = assignmentsData?.data || [];
  const hasWildcardFromApi = assignmentsData?.hasWildcard || false;

  // Update wildcard state when API data changes
  useEffect(() => {
    if (hasWildcardFromApi && !hasWildcard) {
      // Add wildcard to selected nodes if API says it exists but we don't have it
      const wildcardNode: NodeAssignmentWithExpiration = {
        nodeId: null,
        nodeName: 'All Nodes (*)',
        isWildcard: true,
        source: userId ? 'user' : undefined,
      };
      if (!selectedNodes.some(n => n.isWildcard)) {
        onSelectionChange([wildcardNode]);
      }
      setHasWildcard(true);
    } else if (!hasWildcardFromApi && hasWildcard) {
      // Remove wildcard from selected nodes if API says it doesn't exist
      const newSelection = selectedNodes.filter(n => !n.isWildcard && n.nodeId !== null);
      onSelectionChange(newSelection);
      setHasWildcard(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasWildcardFromApi]);

  // Toggle wildcard (all nodes)
  const toggleWildcard = async () => {
    if (disabled) return;

    const targetType = userId ? 'user' : 'role';
    const targetId = userId || roleId;

    // Optimistic UI update - update state immediately
    if (hasWildcard) {
      // Remove wildcard from local state immediately
      const newSelection = selectedNodes.filter(n => !n.isWildcard && n.nodeId !== null);
      onSelectionChange(newSelection);
      setHasWildcard(false);
    } else {
      // Clear all specific nodes and add wildcard immediately
      const wildcardNode: NodeAssignmentWithExpiration = {
        nodeId: null,
        nodeName: 'All Nodes (*)',
        isWildcard: true,
        source: userId ? 'user' : undefined,
      };
      onSelectionChange([wildcardNode]);
      setHasWildcard(true);
    }

    try {
      if (hasWildcard) {
        // Remove wildcard assignment
        await nodesApi.removeWildcard(targetType, targetId!);
        notifySuccess('Wildcard assignment removed');
      } else {
        // Add wildcard assignment - this will remove all specific node assignments
        await nodesApi.assignWildcard({
          targetType,
          targetId: targetId!,
        });
        notifySuccess('All nodes assigned (wildcard)');
      }
      // Invalidate queries after successful API call
      queryClient.invalidateQueries({ queryKey: ['roles', roleId, 'nodes'] });
      queryClient.invalidateQueries({ queryKey: ['users', userId, 'nodes'] });
    } catch (error: any) {
      // Revert on error
      notifyError(error?.response?.data?.error || 'Failed to update wildcard assignment');
      // Revert the optimistic update
      if (hasWildcard) {
        // We tried to remove but failed - add it back
        const wildcardNode: NodeAssignmentWithExpiration = {
          nodeId: null,
          nodeName: 'All Nodes (*)',
          isWildcard: true,
          source: userId ? 'user' : undefined,
        };
        onSelectionChange([...selectedNodes, wildcardNode]);
        setHasWildcard(true);
      } else {
        // We tried to add but failed - restore previous selection
        queryClient.invalidateQueries({ queryKey: ['roles', roleId, 'nodes'] });
        queryClient.invalidateQueries({ queryKey: ['users', userId, 'nodes'] });
      }
    }
  };

  // Toggle node selection
  const toggleNode = async (nodeId: string, nodeName: string) => {
    if (disabled || hasWildcard) return; // Don't allow individual node selection when wildcard is active

    const existingIndex = selectedNodes.findIndex(n => n.nodeId === nodeId);
    const previousSelection = [...selectedNodes];

    // Optimistic UI update
    const newSelection = [...selectedNodes];
    if (existingIndex >= 0) {
      // Remove node
      newSelection.splice(existingIndex, 1);
    } else {
      // Add node (without expiration initially, user can set it)
      newSelection.push({ nodeId, nodeName, source: userId ? 'user' : undefined });
    }
    onSelectionChange(newSelection);

    try {
      if (existingIndex >= 0) {
        // Remove from server
        await removeNodeAssignment(nodeId);
      } else {
        // Add to server
        await addNodeAssignment(nodeId);
      }
    } catch (error: any) {
      // Revert on error
      onSelectionChange(previousSelection);
    }
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
      queryClient.invalidateQueries({ queryKey: ['roles', roleId, 'nodes'] });
      queryClient.invalidateQueries({ queryKey: ['users', userId, 'nodes'] });
      return true;
    } catch (error: any) {
      notifyError(error?.response?.data?.error || 'Failed to assign node');
      return false;
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
        queryClient.invalidateQueries({ queryKey: ['roles', roleId, 'nodes'] });
        queryClient.invalidateQueries({ queryKey: ['users', userId, 'nodes'] });
        return true;
      }
      return false;
    } catch (error: any) {
      notifyError(error?.response?.data?.error || 'Failed to unassign node');
      return false;
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

  // Filter nodes by search (memoized for performance)
  const filteredNodes = useMemo(() =>
    nodes.filter(node =>
      node.name.toLowerCase().includes(search.toLowerCase()) ||
      node.location?.name.toLowerCase().includes(search.toLowerCase())
    ), [nodes, search]
  );

  // Separate inherited (for users) and direct assignments (memoized)
  const directAssignments = useMemo(() =>
    selectedNodes.filter(n => n.source === 'user' || !n.source),
    [selectedNodes]
  );
  const inheritedAssignments = useMemo(() =>
    selectedNodes.filter(n => n.source === 'role'),
    [selectedNodes]
  );

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
                  key={node.nodeId || 'wildcard'}
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
              {directAssignments.filter(n => !n.isWildcard).map(node => (
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
                          setExpirationNodeId(node.nodeId!);
                          setExpirationDate(node.expiresAt || '');
                        }}
                        className="rounded px-1.5 py-0.5 text-[10px] text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-300"
                      >
                        Set Expiration
                      </button>
                      <button
                        onClick={() => toggleNode(node.nodeId!, node.nodeName)}
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
              {/* Wildcard assignment badge */}
              {directAssignments.some(n => n.isWildcard) && (
                <div className="flex items-center justify-between rounded-md border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-500/30 dark:bg-amber-500/10">
                  <div className="flex items-center gap-2">
                    <svg className="h-4 w-4 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    <div className="flex flex-col">
                      <span className="text-xs font-semibold text-amber-900 dark:text-amber-200">All Nodes (*)</span>
                      <span className="text-[10px] text-amber-700 dark:text-amber-400">Access to all current and future nodes</span>
                    </div>
                  </div>
                  {!disabled && (
                    <button
                      onClick={() => toggleWildcard()}
                      className="rounded px-2 py-1 text-[10px] text-amber-700 transition-colors hover:bg-amber-100 hover:text-amber-900 dark:text-amber-300 dark:hover:bg-amber-900/20"
                    >
                      Remove
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Wildcard option at the top of available nodes */}
          <div className="mb-2">
            <label
              className={`flex items-center gap-2 rounded-md border px-2 py-2 text-xs transition-all cursor-pointer ${
                hasWildcard
                  ? 'border-amber-200 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10'
                  : 'border-slate-200 bg-white hover:border-amber-500 hover:bg-amber-50/50 dark:border-slate-800 dark:bg-slate-950 dark:hover:border-amber-500/30 dark:hover:bg-amber-500/5'
              }`}
            >
              <input
                type="checkbox"
                checked={hasWildcard}
                disabled={disabled}
                onChange={() => toggleWildcard()}
                className="h-4 w-4 rounded border-slate-300 bg-white text-amber-600 focus:ring-2 focus:ring-amber-500 dark:border-slate-700 dark:bg-slate-900 dark:text-amber-400 disabled:opacity-50"
              />
              <div className="flex flex-col">
                <span className="font-semibold text-slate-900 dark:text-slate-200">All Nodes (*)</span>
                <span className="text-[10px] text-slate-500 dark:text-slate-400">Access to all current and future nodes</span>
              </div>
            </label>
            {hasWildcard && (
              <div className="mt-1 text-[10px] text-amber-600 dark:text-amber-400 px-2">
                Individual node selection is disabled when wildcard is active
              </div>
            )}
          </div>

          {/* Available nodes header */}
          {!hasWildcard && (
            <div className="text-xs text-slate-500 dark:text-slate-400 mb-1 px-1">
              Select individual nodes
            </div>
          )}

          {/* Available nodes */}
          <div className={`max-h-36 overflow-y-auto pr-1 ${hasWildcard ? 'opacity-50 pointer-events-none' : ''}`}>
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

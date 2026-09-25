import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@/csync';
import { qk } from '@/lib/queryKeys';
import { queryClient } from '@/lib/queryClient';
import { formatDate } from '@/i18n/format';
import { nodesApi } from '../../services/api/nodes';
import { notifyError, notifySuccess } from '../../utils/notify';
import { describeError } from '../../utils/errors';
import { reportSystemError } from '../../services/api/systemErrors';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { BracketLabel, StatusLed } from '@/components/deck/primitives';

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
 label,
}: Props) {
 const { t } = useTranslation('admin');
 const [search, setSearch] = useState('');
 const [expirationNodeId, setExpirationNodeId] = useState<string | null>(null);
 const [expirationDate, setExpirationDate] = useState('');

 // hasWildcard is derived from the current selection. Computing it during
 // render avoids a setState-in-effect and keeps the UI source-of-truth
 // consistent with the parent's selectedNodes prop.
 const hasWildcard = selectedNodes.some(n => n.isWildcard || n.nodeId === null);

 // Fetch available nodes
 const { data: nodes = [], isLoading: nodesLoading } = useQuery({
 queryKey: qk.nodes(),
 queryFn: () => nodesApi.list(),
 staleTime: 60_000,
 });

 // Fetch current assignments for roles
 const { data: roleAssignmentsData, isLoading: roleAssignmentsLoading } = useQuery({
 queryKey: qk.roleNodes(roleId!),
 queryFn: async () => {
 if (!roleId) return { data: [], hasWildcard: false };
 const response = await fetch(`/api/roles/${roleId}/nodes`, {
 headers: { 'Content-Type': 'application/json' },
 });
 const data = await response.json();
 return { data: data.data || [], hasWildcard: data.hasWildcard || false };
 },
 enabled: !!roleId,
 staleTime: 60_000,
 });

 // Fetch current assignments for users
 const { data: userAssignmentsData, isLoading: userAssignmentsLoading } = useQuery({
 queryKey: qk.userNodes(userId!),
 queryFn: async () => {
 if (!userId) return { data: [], hasWildcard: false };
 const response = await fetch(`/api/roles/users/${userId}/nodes`, {
 headers: { 'Content-Type': 'application/json' },
 });
 const data = await response.json();
 return { data: data.data || [], hasWildcard: data.hasWildcard || false };
 },
 enabled: !!userId,
 staleTime: 60_000,
 });

 // Initialize selections from fetched data
 const assignmentsData = userId ? userAssignmentsData : roleAssignmentsData;
 const hasWildcardFromApi = assignmentsData?.hasWildcard || false;

 // Sync wildcard from API data into the parent's selection. The
 // setState-in-effect anti-pattern is avoided by performing the
 // comparison and propagation in the render phase itself: when the
 // derived API state disagrees with the current selection, we
 // invoke onSelectionChange during render, which causes React to
 // restart the render with the new selection. hasWildcard is now
 // derived from selectedNodes rather than stored.
 const [prevWildcardFromApi, setPrevWildcardFromApi] = useState<boolean | null>(null);
 if (hasWildcardFromApi && !hasWildcard && prevWildcardFromApi !== hasWildcardFromApi) {
 setPrevWildcardFromApi(hasWildcardFromApi);
        const wildcardNode: NodeAssignmentWithExpiration = {
          nodeId: null,
          nodeName: t('nodeAssignments.allNodes'),
          isWildcard: true,
          source: userId ? 'user' : undefined,
        };
        onSelectionChange([wildcardNode]);
      } else if (!hasWildcardFromApi && hasWildcard && prevWildcardFromApi !== hasWildcardFromApi) {
 setPrevWildcardFromApi(hasWildcardFromApi);
 onSelectionChange(selectedNodes.filter(n => !n.isWildcard && n.nodeId !== null));
 } else if (prevWildcardFromApi !== hasWildcardFromApi) {
 setPrevWildcardFromApi(hasWildcardFromApi);
 }

 // Whether the component is in "create" mode (no target ID yet — selections are local-only)
 const isCreateMode = !userId && !roleId;

 // Toggle wildcard (all nodes)
 const toggleWildcard = async () => {
 if (disabled) return;

 // Optimistic UI update - update state immediately
 if (hasWildcard) {
 // Remove wildcard from local state immediately
 const newSelection = selectedNodes.filter(n => !n.isWildcard && n.nodeId !== null);
 onSelectionChange(newSelection);
 } else {
      // Clear all specific nodes and add wildcard immediately
      const wildcardNode: NodeAssignmentWithExpiration = {
        nodeId: null,
        nodeName: t('nodeAssignments.allNodes'),
        isWildcard: true,
        source: userId ? 'user' : undefined,
      };
 onSelectionChange([wildcardNode]);
 }

 if (isCreateMode) return; // No API call in create mode

 const targetType = userId ? 'user' : 'role';
 const targetId = userId || roleId;

 try {
 if (hasWildcard) {
 // Remove wildcard assignment
 await nodesApi.removeWildcard(targetType, targetId!);
 notifySuccess(t('nodeAssignments.toast.wildcardRemoved'));
 } else {
 // Add wildcard assignment - this will remove all specific node assignments
 await nodesApi.assignWildcard({
 targetType,
 targetId: targetId!,
 });
 notifySuccess(t('nodeAssignments.toast.wildcardAssigned'));
 }
 // Invalidate queries after successful API call
 Promise.all([
 queryClient.invalidateQueries({ queryKey: qk.roleNodes(roleId!) }),
 queryClient.invalidateQueries({ queryKey: qk.userNodes(userId!) }),
 queryClient.invalidateQueries({ queryKey: qk.nodes() }),
 ]);
 } catch (error: unknown) {
 reportSystemError({
 level: 'error',
 component: 'NodeAssignmentsSelector',
 message: describeError(error),
 stack: error instanceof Error ? error.stack : undefined,
 metadata: { context: 'update wildcard assignment' },
 });
 // Revert on error
 notifyError(error);
 // Revert the optimistic update
 if (hasWildcard) {
 // We tried to remove but failed - add it back
 const wildcardNode: NodeAssignmentWithExpiration = {
 nodeId: null,
 nodeName: t('nodeAssignments.allNodes'),
 isWildcard: true,
 source: userId ? 'user' : undefined,
 };
 onSelectionChange([...selectedNodes, wildcardNode]);
 } else {
 // We tried to add but failed - restore previous selection
 queryClient.invalidateQueries({ queryKey: qk.roleNodes(roleId!) });
 queryClient.invalidateQueries({ queryKey: qk.userNodes(userId!) });
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
 } catch (_error: unknown) {
 reportSystemError({
 level: 'error',
 component: 'NodeAssignmentsSelector',
 message: describeError(_error),
 stack: _error instanceof Error ? _error.stack : undefined,
 metadata: { context: 'toggle node' },
 });
 // Revert on error
 onSelectionChange(previousSelection);
 }
 };

 // Add node assignment to server
 const addNodeAssignment = async (nodeId: string) => {
 if (isCreateMode) return true;
 try {
 const targetType = userId ? 'user' : 'role';
 const targetId = userId || roleId;

 await nodesApi.assignNode(nodeId, {
 targetType,
 targetId: targetId!,
 });

 notifySuccess(t('nodeAssignments.toast.nodeAssigned'));
 Promise.all([
 queryClient.invalidateQueries({ queryKey: qk.roleNodes(roleId!) }),
 queryClient.invalidateQueries({ queryKey: qk.userNodes(userId!) }),
 queryClient.invalidateQueries({ queryKey: qk.nodes() }),
 ]);
 return true;
 } catch (error: unknown) {
 reportSystemError({
 level: 'error',
 component: 'NodeAssignmentsSelector',
 message: describeError(error),
 stack: error instanceof Error ? error.stack : undefined,
 metadata: { context: 'assign node' },
 });
 notifyError(error);
 return false;
 }
 };

 // Remove node assignment from server
 const removeNodeAssignment = async (nodeId: string) => {
 if (isCreateMode) return true;
 try {
 const nodeAssignments = await nodesApi.getAssignments(nodeId);
 const targetId = userId || roleId;
 const targetType = userId ? 'user' : 'role';

 const assignment = nodeAssignments.find(a =>
 targetType === 'user' ? a.userId === targetId : a.roleId === targetId
 );

 if (assignment) {
 await nodesApi.removeAssignment(nodeId, assignment.id);
 notifySuccess(t('nodeAssignments.toast.nodeUnassigned'));
 Promise.all([
 queryClient.invalidateQueries({ queryKey: qk.roleNodes(roleId!) }),
 queryClient.invalidateQueries({ queryKey: qk.userNodes(userId!) }),
 queryClient.invalidateQueries({ queryKey: qk.nodes() }),
 ]);
 return true;
 }
 return false;
 } catch (error: unknown) {
 reportSystemError({
 level: 'error',
 component: 'NodeAssignmentsSelector',
 message: describeError(error),
 stack: error instanceof Error ? error.stack : undefined,
 metadata: { context: 'unassign node' },
 });
 notifyError(error);
 return false;
 }
 };

 // Update expiration date for a node
 const updateExpiration = async (nodeId: string, expiresAt: string) => {
 if (disabled || isCreateMode) return;

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
 notifySuccess(t('nodeAssignments.toast.expirationUpdated'));
 Promise.all([
 queryClient.invalidateQueries({ queryKey: qk.roleNodes(roleId!) }),
 queryClient.invalidateQueries({ queryKey: qk.userNodes(userId!) }),
 queryClient.invalidateQueries({ queryKey: qk.nodes() }),
 ]);
 } catch (error: unknown) {
 reportSystemError({
 level: 'error',
 component: 'NodeAssignmentsSelector',
 message: describeError(error),
 stack: error instanceof Error ? error.stack : undefined,
 metadata: { context: 'update expiration' },
 });
 notifyError(error);
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
 <div className="deck-panel">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 bg-surface-1/40 px-3 py-1.5">
          <BracketLabel>
            {t('nodeAssignments.header', {
              label: label ?? t('nodeAssignments.defaultLabel'),
              value: selectedNodes.length,
            })}
          </BracketLabel>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('nodeAssignments.searchPlaceholder')}
            className="h-7 w-48 rounded-sm border border-border/60 bg-background/40 px-2 text-mini text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary/40"
          />
        </div>

        <div className="p-3">
        {isLoading ? (
          <div className="py-4 text-center text-mini text-muted-foreground">
            {t('nodeAssignments.loading')}
          </div>
        ) : (
          <>
            {/* Selected nodes */}
            {selectedNodes.length > 0 && (
              <div className="mb-3">
                {inheritedAssignments.length > 0 && (
                  <div className="type-overline mb-1">
                    {t('nodeAssignments.inheritedFromRoles')}
                  </div>
                )}
                <div className="divide-y divide-border/40">
                {inheritedAssignments.map(node => (
                  <div
                    key={node.nodeId || 'wildcard'}
                    className="flex items-center justify-between gap-2 py-1.5"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <StatusLed tone="info" />
                      <span className="truncate text-mini font-medium text-foreground">{node.nodeName}</span>
                      {node.roleName && (
                        <span className="text-micro text-primary">
                          {t('nodeAssignments.viaRole', { role: node.roleName })}
                        </span>
                      )}
                    </div>
                    <span className="shrink-0 font-mono text-micro tabular-nums text-muted-foreground">
                      {node.expiresAt
                        ? t('nodeAssignments.expires', { date: formatDate(node.expiresAt) })
                        : t('nodeAssignments.noExpiration')}
                    </span>
                  </div>
                ))}
                {directAssignments.filter(n => !n.isWildcard).map(node => (
                  <div
                    key={node.nodeId}
                    className="flex items-center justify-between gap-2 py-1.5"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <StatusLed tone="go" />
                      <span className="truncate text-mini font-medium text-foreground">{node.nodeName}</span>
                      {node.expiresAt && (
                        <span className="font-mono text-micro tabular-nums text-muted-foreground">
                          {t('nodeAssignments.expires', { date: formatDate(node.expiresAt) })}
                        </span>
                      )}
                    </div>
                    {!disabled && (
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          onClick={() => {
                            setExpirationNodeId(node.nodeId!);
                            setExpirationDate(node.expiresAt || '');
                          }}
                          className="h-7 rounded-sm px-2 text-micro text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
                        >
                          {t('nodeAssignments.setExpiration')}
                        </button>
 <button
 onClick={() => toggleNode(node.nodeId!, node.nodeName)}
 className="flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
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
 <div className="flex items-center justify-between gap-2 py-1.5">
 <div className="flex items-center gap-2">
 <StatusLed tone="hazard" />
 <div className="flex flex-col">
 <span className="text-mini font-semibold text-warning">{t('nodeAssignments.allNodes')}</span>
 <span className="text-micro text-muted-foreground">{t('nodeAssignments.allNodesDescription')}</span>
 </div>
 </div>
 {!disabled && (
 <button
 onClick={() => toggleWildcard()}
 className="h-7 rounded-sm px-2 text-micro text-warning transition-colors hover:bg-warning/10"
 >
 {t('common:actions.remove')}
 </button>
 )}
 </div>
 )}
 </div>
 </div>
 )}

 {/* Wildcard option at the top of available nodes */}
 <div className="mb-2">
 <label
 className={`flex items-center gap-2 rounded-sm border px-2 py-1.5 text-mini transition-colors ${
 hasWildcard
 ? 'border-warning/30 bg-warning/5'
 : 'border-border/50 bg-surface-1/40 hover:border-warning/40'
 } ${disabled ? 'opacity-60' : 'cursor-pointer'}`}
 >
 <input
 type="checkbox"
 checked={hasWildcard}
 disabled={disabled}
 onChange={() => toggleWildcard()}
 className="h-4 w-4 rounded-sm border-border/60 bg-card text-warning focus:ring-2 focus:ring-warning disabled:opacity-50"
 />
 <div className="flex flex-col">
 <span className="font-semibold text-foreground">{t('nodeAssignments.allNodes')}</span>
 <span className="text-micro text-muted-foreground">{t('nodeAssignments.allNodesDescription')}</span>
 </div>
 </label>
 {hasWildcard && (
 <div className="mt-1 px-1 text-micro text-warning">
 {t('nodeAssignments.wildcardDisablesIndividualSelection')}
 </div>
 )}
 </div>

 {/* Available nodes header */}
 {!hasWildcard && (
 <div className="type-overline mb-1 px-1">
 {t('nodeAssignments.selectIndividualNodes')}
 </div>
 )}

 {/* Available nodes */}
 <div className={`max-h-36 overflow-y-auto ${hasWildcard ? 'pointer-events-none opacity-50' : ''}`}>
 {filteredNodes.length === 0 ? (
 <div className="py-2 text-center text-mini text-muted-foreground">
 {t('nodeAssignments.noNodesFound')}
 </div>
 ) : (
 <div className="divide-y divide-border/40">
 {filteredNodes.map((node) => {
 const isSelected = selectedNodes.some(n => n.nodeId === node.id);
 const isInherited = inheritedAssignments.some(n => n.nodeId === node.id);

 return (
 <label
 key={node.id}
 className={`flex items-center gap-2 px-1 py-1.5 text-mini transition-colors ${
 isInherited ? 'cursor-default' : 'cursor-pointer hover:bg-surface-1/40'
 }`}
 >
 {isInherited ? (
 <StatusLed tone="info" />
 ) : (
 <input
 type="checkbox"
 checked={isSelected}
 disabled={disabled || isInherited}
 onChange={() => toggleNode(node.id, node.name)}
 className="h-4 w-4 rounded-sm border-border/60 bg-card text-primary focus:ring-2 focus:ring-primary disabled:opacity-50"
 />
 )}
 <span className={`flex-1 font-medium ${isInherited ? 'text-primary' : 'text-foreground'}`}>{node.name}</span>
 <span className="font-mono text-micro text-muted-foreground">{node.location?.name}</span>
 </label>
 );
 })}
 </div>
 )}
 </div>

        <Dialog
          open={expirationNodeId !== null}
          onOpenChange={(next) => {
            if (!next) {
              setExpirationNodeId(null);
              setExpirationDate('');
            }
          }}
        >
          <DialogContent size="sm">
            <DialogHeader>
              <DialogTitle>{t('nodeAssignments.dialog.title')}</DialogTitle>
              <DialogDescription>
                {t('nodeAssignments.dialog.description', {
                  name: nodes.find((n) => n.id === expirationNodeId)?.name,
                })}
              </DialogDescription>
            </DialogHeader>
            <DialogBody>
              <div className="space-y-2">
                <Label htmlFor="node-assignment-expiration" className="type-overline">
                  {t('nodeAssignments.dialog.expiresAt')}
                </Label>
                <Input
                  id="node-assignment-expiration"
                  type="datetime-local"
                  value={expirationDate}
                  onChange={(e) => setExpirationDate(e.target.value)}
                  min={new Date().toISOString().slice(0, 16)}
                  className="h-8 rounded-sm text-mini"
                />
              </div>
            </DialogBody>
            <DialogFooter>
              <Button
                variant="outline"
                size="sm"
                className="h-8 px-3 text-mini"
                onClick={() => {
                  setExpirationNodeId(null);
                  setExpirationDate('');
                }}
              >
                {t('common:actions.cancel')}
              </Button>
              <Button
                size="sm"
                className="h-8 px-3 text-mini"
                onClick={() => {
                  if (expirationNodeId) updateExpiration(expirationNodeId, expirationDate);
                }}
              >
                {t('common:actions.save')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
 </>
 )}
 </div>
 </div>
 );
}

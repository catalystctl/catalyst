import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { qk } from '@/lib/queryKeys';
import { queryClient } from '@/lib/queryClient';
import { Shield, User, X } from 'lucide-react';
import { Badge } from '../../components/ui/badge';
import { nodesApi } from '../../services/api/nodes';
import { notifyError, notifySuccess } from '../../utils/notify';
import ConfirmDialog from '../shared/ConfirmDialog';
import ServerTabCard from '../servers/tabs/ServerTabCard';
import SectionHeader from '../servers/tabs/SectionHeader';
import TabLoadingState from '../servers/tabs/TabLoadingState';

type Props = {
 nodeId: string;
 canManage: boolean;
};

function NodeAssignmentsList({ nodeId, canManage }: Props) {
 const [pendingRemoveId, setPendingRemoveId] = useState<string | null>(null);

 const { data: assignments = [], isLoading } = useQuery({
 queryKey: qk.nodeAssignments(nodeId),
 queryFn: () => nodesApi.getAssignments(nodeId),
 staleTime: 30_000,
 });

 const removeMutation = useMutation({
 mutationFn: async (assignmentId: string) => {
 return nodesApi.removeAssignment(nodeId, assignmentId);
 },
 onSuccess: () => {
 notifySuccess('Assignment removed');
 setPendingRemoveId(null);
 },
 onSettled: () => {
 queryClient.invalidateQueries({ queryKey: qk.nodeAssignments(nodeId) });
 },
 onError: (error: any) => {
 const message = error?.response?.data?.error || 'Failed to remove assignment';
 notifyError(message);
 },
 });

 const handleRemove = (assignmentId: string) => {
 setPendingRemoveId(assignmentId);
 };

 const confirmRemove = () => {
 if (pendingRemoveId) {
 removeMutation.mutate(pendingRemoveId);
 }
 };

 return (
 <ServerTabCard>
 <div className="mb-3 flex items-center justify-between">
 <SectionHeader icon={Shield} title="Node Assignments" />
 {assignments.length > 0 && (
 <Badge variant="default" className="text-[10px]">
 {assignments.length}
 </Badge>
 )}
 </div>

 {isLoading ? (
 <TabLoadingState rows={2} />
 ) : assignments.length === 0 ? (
 <div className="rounded-lg border border-dashed border-border/40 bg-surface-2/30 py-8 text-center">
 <Shield className="mx-auto mb-2 h-6 w-6 text-muted-foreground/50" />
 <p className="text-sm text-muted-foreground">
 No assignments yet. Assign this node to users or roles to grant them access.
 </p>
 </div>
 ) : (
 <div className="space-y-2">
 {assignments.map((assignment) => (
 <div
 key={assignment.id}
 className="group flex items-center justify-between rounded-lg border border-border/30 bg-surface-2/30 px-3 py-2.5 transition-colors hover:bg-surface-2/50"
 >
 <div className="flex items-center gap-2.5 min-w-0">
 {assignment.source === 'user' ? (
 <>
 <Badge variant="outline" className="shrink-0 gap-1 text-[11px]">
 <User className="h-3 w-3" />
 User
 </Badge>
 <span className="truncate text-sm font-medium text-foreground">
 {assignment.userId}
 </span>
 </>
 ) : (
 <>
 <Badge variant="outline" className="shrink-0 gap-1 text-[11px]">
 <Shield className="h-3 w-3" />
 Role
 </Badge>
 <span className="truncate text-sm font-medium text-foreground">
 {assignment.roleName || assignment.roleId}
 </span>
 </>
 )}
 </div>

 <div className="flex items-center gap-3">
 <div className="hidden text-xs text-muted-foreground sm:block">
 <span>Assigned {new Date(assignment.assignedAt).toLocaleDateString()}</span>
 {assignment.expiresAt && (
 <span
 className={`ml-2 ${
 new Date(assignment.expiresAt) < new Date()
 ? 'text-destructive'
 : ''
 }`}
 >
 · Exp {new Date(assignment.expiresAt).toLocaleDateString()}
 {new Date(assignment.expiresAt) < new Date() && ' (expired)'}
 </span>
 )}
 </div>

 {canManage && (
 <button
 className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-destructive/5 hover:text-destructive disabled:pointer-events-none disabled:opacity-30"
 onClick={() => handleRemove(assignment.id)}
 disabled={removeMutation.isPending}
 title="Remove assignment"
 >
 <X className="h-3.5 w-3.5" />
 </button>
 )}
 </div>
 </div>
 ))}
 </div>
 )}

 <ConfirmDialog
 open={pendingRemoveId !== null}
 title="Remove assignment"
 message="Are you sure you want to remove this assignment? The user or role will lose node access."
 confirmText="Remove"
 variant="danger"
 loading={removeMutation.isPending}
 onConfirm={confirmRemove}
 onCancel={() => {
 if (!removeMutation.isPending) setPendingRemoveId(null);
 }}
 />
 </ServerTabCard>
 );
}

export default NodeAssignmentsList;

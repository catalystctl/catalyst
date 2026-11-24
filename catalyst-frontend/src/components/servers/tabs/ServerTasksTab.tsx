import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@/csync';
import { Loader2, Play } from 'lucide-react';
import ScheduleTaskModal from '../../tasks/ScheduleTaskModal';
import ServerTabCard from './ServerTabCard';
import StatGrid from './StatGrid';
import TabHeader from './TabHeader';
import TabEmptyState from './TabEmptyState';
import TabLoadingState from './TabLoadingState';
import { ConfirmDialog } from '../../shared/ConfirmDialog';
import LastUpdated from '../../shared/LastUpdated';
import { qk } from '../../../lib/queryKeys';
import { Clock } from 'lucide-react';
import { formatDateTime } from '@/i18n/format';
import { tasksApi } from '../../../services/api/tasks';
import { notifyError, notifySuccess } from '../../../utils/notify';
import type { Task } from '../../../types/task';

const formatTaskDateTime = (value?: string | null) =>
 value ? formatDateTime(value) : '—';

interface Props {
 serverId: string;
 isSuspended: boolean;
 tasks: Task[];
 tasksLoading: boolean;
 onPause: (task: { id: string; enabled: boolean }) => void;
 pausePending: boolean;
 onDelete: (taskId: string) => void;
 deletePending: boolean;
}

export default function ServerTasksTab({
 serverId,
 isSuspended,
 tasks: tasksProp,
 tasksLoading,
 onPause,
 pausePending,
 onDelete,
 deletePending,
}: Props) {
 const { t } = useTranslation('server-tabs');
 const queryClient = useQueryClient();
 const tasks = Array.isArray(tasksProp) ? tasksProp : [];
 const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
 const pendingDeleteTask = tasks.find((task) => task.id === pendingDeleteId);

 // Run-now: the backend executes the stored action immediately, so this is the
 // same code path cron uses — no editing the schedule and reverting it.
 const runNowMutation = useMutation({
   mutationFn: (taskId: string) => tasksApi.execute(serverId, taskId),
   onSuccess: (_data, taskId) => {
     const name = tasks.find((task) => task.id === taskId)?.name;
     notifySuccess(name ? t('tasks.runNow.successNamed', { name }) : t('tasks.runNow.success'));
   },
   onError: (error: any) => {
     notifyError(error);
   },
   onSettled: () => {
     queryClient.invalidateQueries({ queryKey: qk.tasks(serverId) });
   },
 });
 const [runningTaskId, setRunningTaskId] = useState<string | null>(null);

 return (
 <div className="space-y-4">
 <TabHeader
 icon={Clock}
 title={t('tabs.tasks.title')}
 description={t('tabs.tasks.description')}
 actions={
 <div className="flex flex-wrap items-center justify-end gap-2">
 {/* Task list is event-driven (task_*) — the stamp shows it is current. */}
 <LastUpdated queryKey={qk.tasks(serverId)} />
 <ScheduleTaskModal serverId={serverId} trigger="primary" disabled={isSuspended} />
 </div>
 }
 />

 <ServerTabCard>
 {tasksLoading ? (
 <TabLoadingState rows={3} />
 ) : tasks.length === 0 ? (
 <TabEmptyState
 title={t('tabs.tasks.emptyTitle')}
 description={t('tabs.tasks.emptyDescription')}
 action={
 <ScheduleTaskModal serverId={serverId} trigger="primary" disabled={isSuspended} />
 }
 />
 ) : (
 <div className="space-y-2">
 {tasks.map((task) => (
 <div
 className="group relative border-b border-border/40 px-3 py-2.5 transition-colors last:border-b-0 hover:bg-surface-1/40"
 key={task.id}
 >

 <div className="flex flex-wrap items-center justify-between gap-2">
 <div className="text-sm font-semibold text-foreground">
 {task.name}
 </div>
 <span className="type-overline rounded-sm bg-surface-2/60 px-2 py-0.5">
 {task.action}
 </span>
 {task.action === 'backup' &&
 (task.payload?.stopBeforeBackup === true ||
 task.payload?.startAfterBackup === true ||
 task.payload?.compressed === false) ? (
 <span className="type-overline rounded-sm bg-surface-2/60 px-2 py-0.5 text-muted-foreground">
 {[
 task.payload?.stopBeforeBackup === true ? t('tasks.backup.badgeStop') : null,
 task.payload?.startAfterBackup === true ? t('tasks.backup.badgeStart') : null,
 task.payload?.compressed === false ? t('tasks.backup.badgeUncompressed') : null,
 ]
 .filter(Boolean)
 .join(' + ')}
 </span>
 ) : null}
 </div>
 {task.description && (
 <div className="type-meta mt-1">
 {task.description}
 </div>
 )}
 <div className="mt-1 font-mono text-mini font-medium tabular-nums text-muted-foreground">
 {task.schedule}
 </div>

 <StatGrid
 columns={4}
 className="mt-2.5"
 items={[
 { label: t('tabs.tasks.nextRun'), value: formatTaskDateTime(task.nextRunAt) },
 { label: t('tabs.tasks.lastRun'), value: formatTaskDateTime(task.lastRunAt) },
 { label: t('shared.status'), value: task.lastStatus ?? '—' },
 { label: t('tabs.tasks.runs'), value: task.runCount ?? 0 },
 ]}
 />

 {task.lastError && (
 <div className="mt-2 max-h-24 overflow-auto break-all rounded-sm border border-danger/20 bg-danger/5 px-3 py-1.5 font-mono text-micro text-danger">
 {task.lastError}
 </div>
 )}

 <div className="mt-3 flex flex-wrap gap-2 text-xs">
 <button
 type="button"
 className="inline-flex h-8 min-h-8 items-center gap-1 rounded-sm border border-primary/30 px-3 text-mini font-semibold text-primary transition-colors duration-200 hover:border-primary/50 hover:bg-primary/5 disabled:opacity-50"
 onClick={() => {
   setRunningTaskId(task.id);
   runNowMutation.mutate(task.id, { onSettled: () => setRunningTaskId(null) });
 }}
 // server.schedule gates the whole tab; a suspended server cannot act.
 disabled={isSuspended || runningTaskId === task.id}
 >
 {runningTaskId === task.id ? (
   <Loader2 className="h-3.5 w-3.5 animate-spin" />
 ) : (
   <Play className="h-3.5 w-3.5" />
 )}
 {runningTaskId === task.id ? t('tasks.runNow.running') : t('tasks.runNow.action')}
 </button>
 <ScheduleTaskModal
 serverId={serverId}
 task={task}
 disabled={isSuspended}
 />
 <button
 type="button"
 className={`rounded-sm border h-8 min-h-8 px-3 text-mini font-semibold transition-colors duration-200 ${
 task.enabled === false
 ? 'border-success/25 text-success hover:border-success/40 hover:bg-success/5'
 : 'border-warning/25 text-warning hover:border-warning/40 hover:bg-warning/5'
 }`}
 onClick={() =>
 onPause(task as { id: string; enabled: boolean })
 }
 disabled={pausePending || isSuspended}
 >
 {task.enabled === false ? t('tabs.tasks.resume') : t('tabs.tasks.pause')}
 </button>
 <button
 type="button"
 className="rounded-sm border border-danger/20 h-8 min-h-8 px-3 text-mini font-semibold text-danger transition-colors duration-200 hover:border-danger/40 hover:bg-danger/5"
 onClick={() => setPendingDeleteId(task.id)}
 disabled={deletePending || isSuspended}
 >
 {t('common:actions.delete')}
 </button>
 </div>
 </div>
 ))}
 </div>
 )}
 </ServerTabCard>

 <ConfirmDialog
 open={Boolean(pendingDeleteId)}
 title={t('tabs.tasks.deleteTitle')}
 message={
 pendingDeleteTask
 ? t('tabs.tasks.deleteConfirm', { name: pendingDeleteTask.name })
 : t('tabs.tasks.deleteConfirmFallback')
 }
 confirmText={t('common:actions.delete')}
 cancelText={t('common:actions.cancel')}
 variant="danger"
 loading={deletePending}
 onConfirm={() => {
 if (!pendingDeleteId) return;
 onDelete(pendingDeleteId);
 setPendingDeleteId(null);
 }}
 onCancel={() => setPendingDeleteId(null)}
 />
 </div>
 );
}

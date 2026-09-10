import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import EditTaskModal from '../../tasks/EditTaskModal';
import CreateTaskModal from '../../tasks/CreateTaskModal';
import ServerTabCard from './ServerTabCard';
import StatGrid from './StatGrid';
import TabHeader from './TabHeader';
import TabEmptyState from './TabEmptyState';
import TabLoadingState from './TabLoadingState';
import { ConfirmDialog } from '../../shared/ConfirmDialog';
import { Clock } from 'lucide-react';
import { formatDateTime } from '@/i18n/format';
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
 const tasks = Array.isArray(tasksProp) ? tasksProp : [];
 const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
 const pendingDeleteTask = tasks.find((task) => task.id === pendingDeleteId);

 return (
 <div className="space-y-4">
 <TabHeader
 icon={Clock}
 title={t('tabs.tasks.title')}
 description={t('tabs.tasks.description')}
 actions={
 <CreateTaskModal serverId={serverId} disabled={isSuspended} />
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
 <CreateTaskModal serverId={serverId} disabled={isSuspended} />
 }
 />
 ) : (
 <div className="space-y-2">
 {tasks.map((task) => (
 <div
 className="group relative rounded-lg border border-border/30 px-4 py-3 transition-all duration-150 hover:border-primary/20 hover:bg-primary/[0.02]"
 key={task.id}
 >
 {/* Left accent bar */}
 <div className={`absolute left-0 top-2 bottom-2 w-0.5 rounded-full transition-colors duration-150 ${
 task.enabled === false
 ? 'bg-warning/40 group-hover:bg-warning/70'
 : 'bg-primary/0 group-hover:bg-primary/50'
 }`} />

 <div className="flex flex-wrap items-center justify-between gap-2">
 <div className="text-sm font-semibold text-foreground">
 {task.name}
 </div>
 <span className="rounded bg-surface-2/60 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
 {task.action}
 </span>
 </div>
 {task.description && (
 <div className="mt-1 text-[11px] text-muted-foreground/60">
 {task.description}
 </div>
 )}
 <div className="mt-1 font-mono text-[10px] tabular-nums text-muted-foreground/50">
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
 <div className="mt-2 rounded-md border border-danger/20 bg-danger/5 px-3 py-1.5 font-mono text-[10px] text-danger">
 {task.lastError}
 </div>
 )}

 <div className="mt-3 flex flex-wrap gap-2 text-xs">
 <EditTaskModal
 serverId={serverId}
 task={task}
 disabled={isSuspended}
 />
 <button
 type="button"
 className={`rounded-md border px-3 py-1 text-[10px] font-semibold transition-all duration-200 ${
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
 className="rounded-md border border-danger/20 px-3 py-1 text-[10px] font-semibold text-danger transition-all duration-200 hover:border-danger/40 hover:bg-danger/5"
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

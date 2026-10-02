import ScheduleTaskModal from './ScheduleTaskModal';
import type { Task } from '../../types/task';

/**
 * @deprecated Kept so the historical import path keeps working — editing reuses
 * the shared {@link ScheduleTaskModal} instead of a bare cron field.
 */
function EditTaskModal({
  serverId,
  task,
  disabled = false,
}: {
  serverId: string;
  task: Omit<Task, 'serverId'>;
  disabled?: boolean;
}) {
  return <ScheduleTaskModal serverId={serverId} task={task} trigger="default" disabled={disabled} />;
}

export default EditTaskModal;

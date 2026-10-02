import ScheduleTaskModal from './ScheduleTaskModal';

/**
 * @deprecated Kept so the historical import path keeps working — the create and
 * edit flows now share {@link ScheduleTaskModal}.
 */
function CreateTaskModal({ serverId, disabled = false }: { serverId: string; disabled?: boolean }) {
  return <ScheduleTaskModal serverId={serverId} trigger="primary" disabled={disabled} />;
}

export default CreateTaskModal;

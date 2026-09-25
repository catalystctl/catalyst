import { useTranslation } from 'react-i18next';
import type { ServerStatus } from '../../types/server';
import { serverStatusLabel } from '../../utils/constants';
import { StatusLed } from '../deck/primitives';
import { cn } from '@/lib/utils';

// State colour lives on the LED and the label; the badge surface stays neutral.
const toneMap: Record<ServerStatus, 'go' | 'hazard' | 'alarm' | 'idle' | 'info'> = {
  stopped: 'idle',
  archived: 'idle',
  running: 'go',
  stopping: 'hazard',
  suspended: 'hazard',
  crashed: 'alarm',
  error: 'alarm',
  installing: 'info',
  starting: 'info',
  transferring: 'info',
  cloning: 'info',
  restoring: 'info',
  creating_backup: 'info',
};

const textMap: Record<ServerStatus, string> = {
  stopped: 'text-muted-foreground',
  archived: 'text-muted-foreground',
  running: 'text-success',
  stopping: 'text-warning',
  suspended: 'text-warning',
  crashed: 'text-danger',
  error: 'text-danger',
  installing: 'text-info',
  starting: 'text-info',
  transferring: 'text-info',
  cloning: 'text-info',
  restoring: 'text-info',
  creating_backup: 'text-info',
};

const TRANSITIONAL: ServerStatus[] = [
  'installing',
  'transferring',
  'cloning',
  'restoring',
  'creating_backup',
  'starting',
  'stopping',
];

type Props = {
  status: ServerStatus;
  operationStage?: string | null;
  operationProgress?: number | null;
};

function ServerStatusBadge({ status, operationStage, operationProgress }: Props) {
  const { t } = useTranslation('servers');
  const showProgress =
    typeof operationProgress === 'number' &&
    operationProgress >= 0 &&
    TRANSITIONAL.includes(status);

  const statusLabel = serverStatusLabel(t, status);
  const label = showProgress
    ? `${statusLabel} ${Math.round(operationProgress)}%`
    : statusLabel;

  const title =
    operationStage || showProgress
      ? [operationStage, showProgress ? `${Math.round(operationProgress!)}%` : null]
          .filter(Boolean)
          .join(' · ')
      : t('common:statusBadge.title', { label: statusLabel });

  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1.5 rounded-sm border border-border/50 bg-surface-1/60 px-2 py-0.5 text-micro font-medium',
        textMap[status],
      )}
      aria-label={title}
      title={title}
    >
      <StatusLed tone={toneMap[status]} pulse={status === 'running'} />
      <span className="truncate">{label}</span>
      {showProgress && (
        <span
          className="ml-0.5 h-1 w-8 overflow-hidden rounded-sm bg-foreground/15"
          aria-hidden
        >
          <span
            className="block h-full rounded-sm bg-current transition-[width] duration-300"
            style={{ width: `${Math.min(100, Math.max(0, operationProgress!))}%` }}
          />
        </span>
      )}
    </span>
  );
}

export default ServerStatusBadge;

import { Square, Loader2, AlertTriangle, ArrowRightLeft, Ban, Copy, HardDriveDownload, Archive, OctagonX } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ServerStatus } from '../../types/server';
import { serverStatusLabel } from '../../utils/constants';

// Live heartbeat for the running state — a pinging dot instead of a static
// glyph, so an up server is visibly *alive* at a glance. Reduced-motion
// users get the static dot (globals.css disables animations).
const RunningPulse = () => (
  <span className="relative flex h-2 w-2 shrink-0" aria-hidden>
    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-50" />
    <span className="relative inline-flex h-2 w-2 rounded-full bg-current" />
  </span>
);

const colorMap: Record<ServerStatus, string> = {
  stopped: 'bg-surface-3 text-muted-foreground',
  installing: 'bg-primary-muted text-primary',
  starting: 'bg-primary-muted text-primary',
  running: 'bg-success-muted text-success',
  stopping: 'bg-warning-muted text-warning',
  crashed: 'bg-danger-muted text-danger',
  transferring: 'bg-info-muted text-info',
  cloning: 'bg-info-muted text-info',
  suspended: 'bg-danger-muted text-danger',
  restoring: 'bg-info-muted text-info',
  creating_backup: 'bg-info-muted text-info',
  archived: 'bg-surface-3 text-muted-foreground',
  error: 'bg-danger-muted text-danger',
};

const iconMap: Record<ServerStatus, React.ReactNode> = {
  stopped: <Square className="h-3 w-3" />,
  installing: <Loader2 className="h-3 w-3 animate-spin" />,
  starting: <Loader2 className="h-3 w-3 animate-spin" />,
  running: <RunningPulse />,
  stopping: <Loader2 className="h-3 w-3 animate-spin" />,
  crashed: <AlertTriangle className="h-3 w-3" />,
  transferring: <ArrowRightLeft className="h-3 w-3" />,
  cloning: <Copy className="h-3 w-3 animate-pulse" />,
  suspended: <Ban className="h-3 w-3" />,
  restoring: <HardDriveDownload className="h-3 w-3 animate-pulse" />,
  creating_backup: <Archive className="h-3 w-3 animate-pulse" />,
  archived: <Archive className="h-3 w-3" />,
  error: <OctagonX className="h-3 w-3" />,
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
      className={`inline-flex max-w-full items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-semibold ${colorMap[status]}`}
      aria-label={title}
      title={title}
    >
      {iconMap[status]}
      <span className="truncate">{label}</span>
      {showProgress && (
        <span
          className="ml-0.5 h-1 w-8 overflow-hidden rounded-full bg-foreground/15"
          aria-hidden
        >
          <span
            className="block h-full rounded-full bg-current transition-[width] duration-300"
            style={{ width: `${Math.min(100, Math.max(0, operationProgress!))}%` }}
          />
        </span>
      )}
    </span>
  );
}

export default ServerStatusBadge;

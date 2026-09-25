import { useTranslation } from 'react-i18next';
import { StatusLed } from '../deck/primitives';

/** Props unchanged: the deck LED replaces the old pill badge. */
function NodeStatusBadge({ isOnline }: { isOnline: boolean }) {
  const { t } = useTranslation('nodes');
  return (
    <span className={`inline-flex items-center gap-1.5 text-mini ${isOnline ? 'text-success' : 'text-muted-foreground'}`}>
      <StatusLed tone={isOnline ? 'go' : 'idle'} pulse={isOnline} />
      {isOnline ? t('common:status.online') : t('common:status.offline')}
    </span>
  );
}

export default NodeStatusBadge;

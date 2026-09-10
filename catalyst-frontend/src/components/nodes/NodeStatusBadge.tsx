import { useTranslation } from 'react-i18next';

function NodeStatusBadge({ isOnline }: { isOnline: boolean }) {
 const { t } = useTranslation('nodes');
 return (
 <span
 className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
 isOnline
 ? 'bg-success/5 text-success'
 : 'bg-surface-2 text-muted-foreground'
 }`}
 >
 <span className={`h-1.5 w-1.5 rounded-full ${isOnline ? 'bg-success/50' : 'bg-muted-foreground'}`} />
 {isOnline ? t('common:status.online') : t('common:status.offline')}
 </span>
 );
}

export default NodeStatusBadge;

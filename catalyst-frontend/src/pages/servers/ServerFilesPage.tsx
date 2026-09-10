import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { FolderOpen } from 'lucide-react';
import TabHeader from '../../components/servers/tabs/TabHeader';
import ServerTabCard from '../../components/servers/tabs/ServerTabCard';
import TabLoadingState from '../../components/servers/tabs/TabLoadingState';
import TabErrorState from '../../components/servers/tabs/TabErrorState';
import FileManager from '../../components/files/FileManager';
import EmptyState from '../../components/shared/EmptyState';
import { useServer } from '../../hooks/useServer';

function ServerFilesPage() {
 const { t } = useTranslation('servers');
 const { serverId } = useParams();
 const { data: server, isLoading, isError, refetch } = useServer(serverId);
 const title = server?.name ?? serverId ?? t('unknownServer');

 if (!serverId) {
 return (
 <EmptyState
 title={t('files.noServerTitle')}
 description={t('files.noServerDescription')}
 />
 );
 }

 return (
 <div className="space-y-4">
 <TabHeader
 icon={FolderOpen}
 title={t('files.title')}
 description={t('files.description', { name: title })}
 />

 {isLoading ? (
 <TabLoadingState />
 ) : isError ? (
 <TabErrorState
 message={t('errors.unableToLoadServerDetails')}
 onRetry={() => refetch()}
 />
 ) : (
 <ServerTabCard>
 <FileManager
 serverId={serverId}
 isSuspended={server?.status === 'suspended'}
 canWrite={Boolean(
 server?.effectivePermissions?.includes('*') ||
 server?.effectivePermissions?.includes('file.write'),
 )}
 />
 </ServerTabCard>
 )}
 </div>
 );
}

export default ServerFilesPage;

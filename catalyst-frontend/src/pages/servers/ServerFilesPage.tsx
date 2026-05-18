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
 const { serverId } = useParams();
 const { data: server, isLoading, isError, refetch } = useServer(serverId);
 const title = server?.name ?? serverId ?? 'Unknown server';

 if (!serverId) {
 return (
 <EmptyState
 title="No server selected"
 description="Select a server to manage its files."
 />
 );
 }

 return (
 <div className="space-y-4">
 <TabHeader
 icon={FolderOpen}
 title="Files"
 description={`${title} · Upload, edit, and manage server files.`}
 />

 {isLoading ? (
 <TabLoadingState />
 ) : isError ? (
 <TabErrorState
 message="Unable to load server details."
 onRetry={() => refetch()}
 />
 ) : (
 <ServerTabCard>
 <FileManager serverId={serverId} isSuspended={server?.status === 'suspended'} />
 </ServerTabCard>
 )}
 </div>
 );
}

export default ServerFilesPage;

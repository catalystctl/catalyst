import { useTranslation } from 'react-i18next';
import SftpConnectionInfo from '../../files/SftpConnectionInfo';
import ServerTabCard from './ServerTabCard';
import TabHeader from './TabHeader';
import { FolderSync } from 'lucide-react';

interface Props {
 serverId: string;
 ownerId: string;
 currentUserId?: string;
}

export default function ServerSftpTab({ serverId, ownerId, currentUserId }: Props) {
 const { t } = useTranslation('server-tabs');
 return (
 <div className="space-y-4">
 <TabHeader
 icon={FolderSync}
 title={t('tabs.sftp.title')}
 description={t('tabs.sftp.description')}
 />
 <ServerTabCard>
 <SftpConnectionInfo
 serverId={serverId}
 isOwner={ownerId === currentUserId}
 />
 </ServerTabCard>
 </div>
 );
}

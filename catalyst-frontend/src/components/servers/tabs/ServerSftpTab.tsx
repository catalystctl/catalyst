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
 return (
 <div className="space-y-4">
 <TabHeader
 icon={FolderSync}
 title="SFTP Access"
 description="Connect to your server files via SFTP using the credentials below."
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

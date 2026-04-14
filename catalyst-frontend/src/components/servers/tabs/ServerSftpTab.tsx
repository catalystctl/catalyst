import SftpConnectionInfo from '../../files/SftpConnectionInfo';
import ServerTabCard from './ServerTabCard';

interface Props {
  serverId: string;
  ownerId: string;
  currentUserId?: string;
}

export default function ServerSftpTab({ serverId, ownerId, currentUserId }: Props) {
  return (
    <ServerTabCard className="border-border bg-card px-6 py-5">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-foreground">SFTP Access</h2>
        <p className="text-xs text-muted-foreground">
          Connect to your server files via SFTP using the credentials below.
        </p>
      </div>
      <SftpConnectionInfo
        serverId={serverId}
        isOwner={ownerId === currentUserId}
      />
    </ServerTabCard>
  );
}

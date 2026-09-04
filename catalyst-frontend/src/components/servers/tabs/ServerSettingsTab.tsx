import { useState } from 'react';
import ServerTabCard from './ServerTabCard';
import TabHeader from './TabHeader';
import { useQueryClient } from '@/csync';
import { qk } from '../../../lib/queryKeys';
import { serversApi } from '../../../services/api/servers';
import { notifySuccess, notifyError } from '../../../utils/notify';
import { reportSystemError } from '../../../services/api/systemErrors';
import { describeError } from '../../../utils/errors';
import CloneServerDialog from '../CloneServerDialog';
import { ConfirmDialog } from '../../shared/ConfirmDialog';
import type { Server } from '../../../types/server';
import { Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import SettingsRow from './SettingsRow';


interface Props {
 serverId: string;
 serverName: string;
 onServerNameChange: (name: string) => void;
 renamePending: boolean;
 onRename: () => void;
 isSuspended: boolean;
 serverStatus: string;
 server: Server;
 /** Effective server permissions used to gate reinstall. */
 permissions?: string[];
}

export default function ServerSettingsTab({
 serverId,
 serverName,
 onServerNameChange,
 renamePending,
 onRename,
 isSuspended,
 serverStatus,
 server,
 permissions,
}: Props) {
 const queryClient = useQueryClient();
 const [showReinstallConfirm, setShowReinstallConfirm] = useState(false);
 const [reinstallPending, setReinstallPending] = useState(false);
 const [showCancelInstallConfirm, setShowCancelInstallConfirm] = useState(false);
 const [cancelInstallPending, setCancelInstallPending] = useState(false);

 const permSet = new Set(permissions ?? []);
 const canReinstall =
   permSet.has('*') ||
   permSet.has('server.install') ||
   permSet.has('server.reinstall');
 const isInstalling = serverStatus === 'installing';

 const handleReinstall = async () => {
 setReinstallPending(true);
 try {
 await serversApi.install(serverId);
 notifySuccess('Reinstall started');
 setShowReinstallConfirm(false);
 } catch (error: unknown) {
 reportSystemError({
 level: 'error',
 component: 'ServerSettingsTab',
 message: describeError(error),
 stack: error instanceof Error ? error.stack : undefined,
 metadata: { context: 'reinstall server' },
 });
 notifyError(error instanceof Error ? error.message : 'Failed to reinstall server');
 } finally {
 setReinstallPending(false);
 queryClient.invalidateQueries({ queryKey: qk.server(serverId) });
 queryClient.invalidateQueries({ queryKey: qk.servers() });
 }
 };

 const handleCancelInstall = async () => {
 setCancelInstallPending(true);
 try {
 await serversApi.cancelInstall(serverId);
 notifySuccess('Install cancelled');
 setShowCancelInstallConfirm(false);
 } catch (error: unknown) {
 reportSystemError({
 level: 'error',
 component: 'ServerSettingsTab',
 message: describeError(error),
 stack: error instanceof Error ? error.stack : undefined,
 metadata: { context: 'cancel install' },
 });
 notifyError(error instanceof Error ? error.message : 'Failed to cancel install');
 } finally {
 setCancelInstallPending(false);
 queryClient.invalidateQueries({ queryKey: qk.server(serverId) });
 queryClient.invalidateQueries({ queryKey: qk.servers() });
 }
 };

 return (
 <div className="space-y-4">
 <TabHeader
 icon={Settings}
 title="Settings"
 description="Manage server name and maintenance options."
 />
    <ServerTabCard>
      <SettingsRow label="Name" description="Shown in lists and the server header.">
        <Input
          className="min-w-[160px]"
          value={serverName}
          onChange={(e) => onServerNameChange(e.target.value)}
          placeholder="Server name"
          disabled={isSuspended}
        />
        <Button type="button" size="sm" onClick={onRename} disabled={renamePending || isSuspended || !serverName.trim()}>
          Save
        </Button>
      </SettingsRow>
      <SettingsRow label="Maintenance">
        {canReinstall && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="border-warning/30 text-warning hover:bg-warning/10"
            disabled={serverStatus !== 'stopped' || isSuspended || reinstallPending}
            onClick={() => setShowReinstallConfirm(true)}
          >
            Reinstall
          </Button>
        )}
        {canReinstall && isInstalling && (
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={isSuspended || cancelInstallPending}
            onClick={() => setShowCancelInstallConfirm(true)}
          >
            {cancelInstallPending ? 'Cancelling…' : 'Cancel install'}
          </Button>
        )}
        <CloneServerDialog server={server} disabled={isSuspended} />
      </SettingsRow>
    </ServerTabCard>



 <ConfirmDialog
 open={showReinstallConfirm}
 title="Reinstall server?"
 message="This will wipe server files and re-run the install script. Data that is not backed up will be lost. Are you sure?"
 confirmText="Reinstall"
 cancelText="Cancel"
 variant="danger"
 loading={reinstallPending}
 onConfirm={() => { void handleReinstall(); }}
 onCancel={() => setShowReinstallConfirm(false)}
 />
 <ConfirmDialog
 open={showCancelInstallConfirm}
 title="Cancel install?"
 message="This will kill the stuck installer container and reset the server to stopped so you can reinstall. Partial install files are kept. Are you sure?"
 confirmText="Cancel install"
 cancelText="Keep installing"
 variant="danger"
 loading={cancelInstallPending}
 onConfirm={() => { void handleCancelInstall(); }}
 onCancel={() => setShowCancelInstallConfirm(false)}
 />
 </div>
 );
}

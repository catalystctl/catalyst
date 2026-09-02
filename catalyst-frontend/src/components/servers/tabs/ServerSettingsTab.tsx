import { useState } from 'react';
import ServerTabCard from './ServerTabCard';
import TabHeader from './TabHeader';
import { useQueryClient, useMutation } from '@/csync';
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
 subdomain: string | null;
 server: Server;
 /** Effective server permissions used to gate reinstall. */
 permissions?: string[];
}

const SUBDOMAIN_REGEX = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

export default function ServerSettingsTab({
 serverId,
 serverName,
 onServerNameChange,
 renamePending,
 onRename,
 isSuspended,
 serverStatus,
 subdomain,
 server,
 permissions,
}: Props) {
 const queryClient = useQueryClient();
 const [subdomainInput, setSubdomainInput] = useState(subdomain ?? '');
 const [showReinstallConfirm, setShowReinstallConfirm] = useState(false);
 const [reinstallPending, setReinstallPending] = useState(false);

 const permSet = new Set(permissions ?? []);
 const canReinstall =
   permSet.has('*') ||
   permSet.has('server.install') ||
   permSet.has('server.reinstall');

 const updateSubdomainMutation = useMutation({
 mutationFn: (value: string | null) => serversApi.updateSubdomain(serverId, value),
 onSuccess: () => notifySuccess('Subdomain updated'),
 onSettled: () => {
 queryClient.invalidateQueries({ queryKey: qk.server(serverId) });
 queryClient.invalidateQueries({ queryKey: qk.servers() });
 },
 onError: (error: any) => notifyError(error?.response?.data?.error || 'Failed to update subdomain'),
 });

 const isValidSubdomain = (value: string) => {
 if (!value) return true;
 return SUBDOMAIN_REGEX.test(value);
 };

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

 return (
 <div className="space-y-4">
 <TabHeader
 icon={Settings}
 title="Settings"
 description="Manage server name, subdomain, and maintenance options."
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
      <SettingsRow label="Subdomain" description="Optional hostname label for this server.">
        <div className="flex flex-col items-end gap-1">
          <div className="flex items-center gap-2">
            <Input
              className="min-w-[160px] font-mono"
              value={subdomainInput}
              onChange={(e) => setSubdomainInput(e.target.value)}
              placeholder="my-server"
              disabled={isSuspended || updateSubdomainMutation.isPending}
            />
            <Button
              type="button"
              size="sm"
              onClick={() => updateSubdomainMutation.mutate(subdomainInput.trim() || null)}
              disabled={
                updateSubdomainMutation.isPending ||
                isSuspended ||
                !isValidSubdomain(subdomainInput.trim())
              }
            >
              Save
            </Button>
          </div>
          {subdomainInput && !isValidSubdomain(subdomainInput.trim()) && (
            <p className="text-xs text-danger">Lowercase letters, numbers, and hyphens only.</p>
          )}
        </div>
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
 </div>
 );
}

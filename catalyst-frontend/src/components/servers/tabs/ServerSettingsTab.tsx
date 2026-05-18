import { useState } from 'react';
import ServerTabCard from './ServerTabCard';
import TabHeader from './TabHeader';
import SectionHeader from './SectionHeader';
import { useQueryClient, useMutation } from '@tanstack/react-query';
import { qk } from '../../../lib/queryKeys';
import { serversApi } from '../../../services/api/servers';
import { notifySuccess, notifyError } from '../../../utils/notify';
import { reportSystemError } from '../../../services/api/systemErrors';
import CloneServerDialog from '../CloneServerDialog';
import type { Server } from '../../../types/server';
import { Settings, PenLine, Globe, Wrench } from 'lucide-react';

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
}: Props) {
 const queryClient = useQueryClient();
 const [subdomainInput, setSubdomainInput] = useState(subdomain ?? '');

 const updateSubdomainMutation = useMutation({
 mutationFn: (value: string | null) => serversApi.updateSubdomain(serverId, value),
 onSuccess: () => {
 notifySuccess('Subdomain updated');
 queryClient.invalidateQueries({ queryKey: qk.server(serverId) });
 queryClient.invalidateQueries({ queryKey: ['servers'] });
 },
 onError: (error: any) => notifyError(error?.response?.data?.error || 'Failed to update subdomain'),
 });

 const isValidSubdomain = (value: string) => {
 if (!value) return true;
 return SUBDOMAIN_REGEX.test(value);
 };

 const handleReinstall = async () => {
 try {
 await serversApi.install(serverId);
 queryClient.invalidateQueries({ queryKey: qk.server(serverId) });
 queryClient.invalidateQueries({ queryKey: ['servers'] });
 notifySuccess('Reinstall started');
 } catch (error: unknown) {
 reportSystemError({
 level: 'error',
 component: 'ServerSettingsTab',
 message: error instanceof Error ? error.message : String(error),
 stack: error instanceof Error ? error.stack : undefined,
 metadata: { context: 'reinstall server' },
 });
 notifyError(error instanceof Error ? error.message : 'Failed to reinstall server');
 }
 };

 return (
 <div className="space-y-4">
 <TabHeader
 icon={Settings}
 title="Settings"
 description="Manage server name, subdomain, and maintenance options."
 />

 <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
 <ServerTabCard>
 <SectionHeader icon={PenLine} title="Rename server" />
 <div className="flex flex-wrap items-center gap-2">
 <input
 className="min-w-[180px] flex-1 rounded-md border border-border/40 bg-card px-3 py-2 text-xs text-foreground transition-colors focus:border-primary focus:outline-none"
 value={serverName}
 onChange={(e) => onServerNameChange(e.target.value)}
 placeholder="Server name"
 disabled={isSuspended}
 />
 <button
 type="button"
 className="rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground transition-all hover:bg-primary/90 disabled:opacity-50"
 onClick={onRename}
 disabled={renamePending || isSuspended || !serverName.trim()}
 >
 Save
 </button>
 </div>
 </ServerTabCard>

 <ServerTabCard>
 <SectionHeader icon={Globe} title="Subdomain" />
 <div className="flex flex-wrap items-center gap-2">
 <input
 className="min-w-[180px] flex-1 rounded-md border border-border/40 bg-card px-3 py-2 font-mono text-xs text-foreground transition-colors focus:border-primary focus:outline-none disabled:opacity-50"
 value={subdomainInput}
 onChange={(e) => setSubdomainInput(e.target.value)}
 placeholder="my-server"
 disabled={isSuspended || updateSubdomainMutation.isPending}
 />
 <button
 type="button"
 className="rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground transition-all hover:bg-primary/90 disabled:opacity-50"
 onClick={() => updateSubdomainMutation.mutate(subdomainInput.trim() || null)}
 disabled={
 updateSubdomainMutation.isPending ||
 isSuspended ||
 !isValidSubdomain(subdomainInput.trim())
 }
 >
 Save
 </button>
 </div>
 {subdomainInput && !isValidSubdomain(subdomainInput.trim()) && (
 <p className="mt-2 text-[10px] text-danger">
 Lowercase letters, numbers, and hyphens only.
 </p>
 )}
 </ServerTabCard>

 <ServerTabCard>
 <SectionHeader icon={Wrench} title="Maintenance" />
 <div className="flex flex-wrap gap-2">
 <button
 type="button"
 className="rounded-md border border-warning/25 bg-warning/10 px-3 py-1.5 text-xs font-semibold text-warning transition-all hover:border-warning/40 hover:bg-warning/15 disabled:opacity-50"
 disabled={serverStatus !== 'stopped' || isSuspended}
 onClick={handleReinstall}
 >
 Reinstall
 </button>
 <CloneServerDialog server={server} disabled={isSuspended} />
 </div>
 </ServerTabCard>
 </div>
 </div>
 );
}

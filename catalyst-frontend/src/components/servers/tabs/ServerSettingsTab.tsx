import { useState } from 'react';
import ServerTabCard from './ServerTabCard';
import { useQueryClient, useMutation } from '@tanstack/react-query';
import { qk } from '../../../lib/queryKeys';
import { serversApi } from '../../../services/api/servers';
import { notifySuccess, notifyError } from '../../../utils/notify';
import { reportSystemError } from '../../../services/api/systemErrors';

interface Props {
  serverId: string;
  serverName: string;
  onServerNameChange: (name: string) => void;
  renamePending: boolean;
  onRename: () => void;
  isSuspended: boolean;
  serverStatus: string;
  subdomain: string | null;
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
      notifyError(
        error instanceof Error ? error.message : 'Failed to reinstall server',
      );
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ServerTabCard>
          <div className="text-sm font-semibold text-foreground">
            Rename server
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Update how this server appears in your list.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <input
              className="min-w-[220px] flex-1 rounded-lg border border-border bg-card px-3 py-2 text-xs text-foreground transition-all duration-300 focus:border-primary focus:outline-none"
              value={serverName}
              onChange={(event) => onServerNameChange(event.target.value)}
              placeholder="Server name"
              disabled={isSuspended}
            />
            <button
              type="button"
              className="rounded-md bg-primary px-3 py-2 font-semibold text-primary-foreground shadow-lg shadow-primary-500/20 transition-all duration-300 hover:bg-primary/90 disabled:opacity-60"
              onClick={onRename}
              disabled={renamePending || isSuspended || !serverName.trim()}
            >
              Save
            </button>
          </div>
        </ServerTabCard>
        <ServerTabCard>
          <div className="text-sm font-semibold text-foreground">
            Subdomain
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Assign a subdomain for easy server access (e.g., my-server).
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <input
              className="min-w-[220px] flex-1 rounded-lg border border-border bg-card px-3 py-2 text-xs text-foreground transition-all duration-300 focus:border-primary focus:outline-none disabled:opacity-60"
              value={subdomainInput}
              onChange={(event) => setSubdomainInput(event.target.value)}
              placeholder="my-server"
              disabled={isSuspended || updateSubdomainMutation.isPending}
            />
            <button
              type="button"
              className="rounded-md bg-primary px-3 py-2 font-semibold text-primary-foreground shadow-lg shadow-primary-500/20 transition-all duration-300 hover:bg-primary/90 disabled:opacity-60"
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
            <p className="mt-1 text-[11px] text-destructive">
              Invalid subdomain format. Use lowercase letters, numbers, and hyphens only.
            </p>
          )}
        </ServerTabCard>
        <ServerTabCard>
          <div className="text-sm font-semibold text-foreground">
            Maintenance
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Reinstalling will re-run the template install script and may overwrite
            files.
          </p>
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <button
              type="button"
              className="rounded-md bg-warning px-3 py-1 font-semibold text-foreground shadow-lg shadow-warning/20 transition-all duration-300 hover:bg-warning disabled:opacity-60"
              disabled={serverStatus !== 'stopped' || isSuspended}
              onClick={handleReinstall}
            >
              Reinstall
            </button>
          </div>
        </ServerTabCard>
      </div>
    </div>
  );
}

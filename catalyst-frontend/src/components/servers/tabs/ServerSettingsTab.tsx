import ServerTabCard from './ServerTabCard';
import { useQueryClient } from '@tanstack/react-query';
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
}

export default function ServerSettingsTab({
  serverId,
  serverName,
  onServerNameChange,
  renamePending,
  onRename,
  isSuspended,
  serverStatus,
}: Props) {
  const queryClient = useQueryClient();

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
              className="min-w-[220px] flex-1 rounded-lg border border-border bg-card px-3 py-2 text-xs text-foreground transition-all duration-300 focus:border-primary-500 focus:outline-none dark:focus:border-primary-400"
              value={serverName}
              onChange={(event) => onServerNameChange(event.target.value)}
              placeholder="Server name"
              disabled={isSuspended}
            />
            <button
              type="button"
              className="rounded-md bg-primary-600 px-3 py-2 font-semibold text-white shadow-lg shadow-primary-500/20 transition-all duration-300 hover:bg-primary-500 disabled:opacity-60"
              onClick={onRename}
              disabled={renamePending || isSuspended || !serverName.trim()}
            >
              Save
            </button>
          </div>
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
              className="rounded-md bg-warning px-3 py-1 font-semibold text-white shadow-lg shadow-warning/20 transition-all duration-300 hover:bg-warning disabled:opacity-60"
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

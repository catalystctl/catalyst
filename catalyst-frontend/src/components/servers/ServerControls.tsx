import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { serversApi } from '../../services/api/servers';
import { notifyError, notifySuccess } from '../../utils/notify';
import { ConfirmDialog } from '../shared/ConfirmDialog';
import type { ServerStatus } from '../../types/server';

type Props = {
  serverId: string;
  status: ServerStatus;
  permissions?: string[];
};

function ServerControls({ serverId, status, permissions }: Props) {
  const queryClient = useQueryClient();
  const isSuspended = status === 'suspended';
  const [showKillConfirm, setShowKillConfirm] = useState(false);

  const p = new Set(permissions ?? []);
  const canStart = p.size === 0 || p.has('server.start');
  const canStop = p.size === 0 || p.has('server.stop');
  const canRestart = canStart && canStop;
  const canKill = canStop;

  const invalidate = () =>
    queryClient.invalidateQueries({
      predicate: (query) => Array.isArray(query.queryKey) && query.queryKey[0] === 'servers',
    });

  const start = useMutation({
    mutationFn: () => serversApi.start(serverId),
    onSuccess: () => { invalidate(); notifySuccess('Server started'); },
    onError: () => notifyError('Failed to start server'),
  });
  const stop = useMutation({
    mutationFn: () => serversApi.stop(serverId),
    onSuccess: () => { invalidate(); notifySuccess('Server stopped'); },
    onError: () => notifyError('Failed to stop server'),
  });
  const restart = useMutation({
    mutationFn: () => serversApi.restart(serverId),
    onSuccess: () => { invalidate(); notifySuccess('Server restarted'); },
    onError: () => notifyError('Failed to restart server'),
  });
  const kill = useMutation({
    mutationFn: () => serversApi.kill(serverId),
    onSuccess: () => { invalidate(); notifySuccess('Server killed'); setShowKillConfirm(false); },
    onError: () => { notifyError('Failed to kill server'); setShowKillConfirm(false); },
  });

  if (permissions && permissions.length > 0 && !canStart && !canStop && !canKill) {
    return null;
  }

  return (
    <>
      <div className="flex flex-wrap gap-1.5 text-xs">
        {canStart && (
          <button
            className="rounded-lg bg-success px-3 py-1.5 font-semibold text-white transition-all duration-200 hover:opacity-90 disabled:opacity-40"
            disabled={start.isPending || status === 'running' || isSuspended}
            onClick={() => start.mutate()}
          >
            Start
          </button>
        )}
        {canStop && (
          <button
            className="rounded-lg bg-zinc-700 px-3 py-1.5 font-semibold text-zinc-100 transition-all duration-200 hover:bg-zinc-600 disabled:opacity-40 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
            disabled={stop.isPending || status === 'stopped' || isSuspended}
            onClick={() => stop.mutate()}
          >
            Stop
          </button>
        )}
        {canRestart && (
          <button
            className="rounded-lg bg-primary px-3 py-1.5 font-semibold text-primary-foreground transition-all duration-200 hover:opacity-90 disabled:opacity-40"
            disabled={restart.isPending || isSuspended}
            onClick={() => restart.mutate()}
          >
            Restart
          </button>
        )}
        {canKill && (
          <button
            className="rounded-lg bg-danger px-3 py-1.5 font-semibold text-white transition-all duration-200 hover:opacity-90 disabled:opacity-40"
            disabled={kill.isPending || isSuspended || status === 'stopped'}
            onClick={() => setShowKillConfirm(true)}
          >
            Kill
          </button>
        )}
      </div>

      <ConfirmDialog
        open={showKillConfirm}
        title="Kill server?"
        message="This will force-terminate the server process immediately without saving. Data may be lost. Are you sure?"
        confirmText="Kill"
        cancelText="Cancel"
        variant="danger"
        loading={kill.isPending}
        onConfirm={() => kill.mutate()}
        onCancel={() => setShowKillConfirm(false)}
      />
    </>
  );
}

export default ServerControls;

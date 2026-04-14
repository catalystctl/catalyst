import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { serversApi } from '../../services/api/servers';
import { notifyError, notifySuccess } from '../../utils/notify';
import { ConfirmDialog } from '../shared/ConfirmDialog';
import { Button } from '@/components/ui/button';
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
          <Button
            size="sm"
            className="bg-success text-white hover:opacity-90"
            disabled={start.isPending || status === 'running' || isSuspended}
            onClick={() => start.mutate()}
          >
            Start
          </Button>
        )}
        {canStop && (
          <Button
            size="sm"
            variant="secondary"
            disabled={stop.isPending || status === 'stopped' || isSuspended}
            onClick={() => stop.mutate()}
          >
            Stop
          </Button>
        )}
        {canRestart && (
          <Button
            size="sm"
            disabled={restart.isPending || isSuspended}
            onClick={() => restart.mutate()}
          >
            Restart
          </Button>
        )}
        {canKill && (
          <Button
            size="sm"
            variant="destructive"
            disabled={kill.isPending || isSuspended || status === 'stopped'}
            onClick={() => setShowKillConfirm(true)}
          >
            Kill
          </Button>
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

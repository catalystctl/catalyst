import { useState } from 'react';
import { useMutation, useQueryClient } from '@/csync';
import { serversApi } from '../../services/api/servers';
import { qk } from '../../lib/queryKeys';

import { optimisticInvalidate, patchServerListStatus } from '../../lib/queryUtils';
import { notifyError, notifySuccess } from '../../utils/notify';
import { ConfirmDialog } from '../shared/ConfirmDialog';
import { Button } from '@/components/ui/button';
import type { Server, ServerStatus } from '../../types/server';

type Props = {
  serverId: string;
  status: ServerStatus;
  permissions?: string[];
};

const OPTIMISTIC_STATUS: Record<string, ServerStatus> = {
  start: 'starting',
  stop: 'stopping',
  restart: 'starting',
  kill: 'stopping',
};

const STARTABLE: ServerStatus[] = ['stopped', 'crashed', 'error'];
const STOPPABLE: ServerStatus[] = ['running', 'starting', 'error', 'crashed'];
const RESTARTABLE: ServerStatus[] = ['running', 'stopped', 'error', 'crashed'];
const KILLABLE: ServerStatus[] = ['running', 'starting', 'stopping', 'error', 'crashed'];

function ServerControls({ serverId, status, permissions }: Props) {
  const queryClient = useQueryClient();
  const [showKillConfirm, setShowKillConfirm] = useState(false);

  // Fail CLOSED: missing/empty permissions hide all power controls.
  const p = new Set(permissions ?? []);
  const hasWildcard = p.has('*');
  const canStart = hasWildcard || p.has('server.start');
  const canStop = hasWildcard || p.has('server.stop');
  const canRestart = canStart && canStop;
  const canKill = canStop;

  async function snapshotAndOptimistic(nextStatus: ServerStatus) {
    await queryClient.cancelQueries({ queryKey: qk.server(serverId) });
    await queryClient.cancelQueries({ queryKey: qk.servers() });
    const prevServer = queryClient.getQueryData<Server>(qk.server(serverId));
    // Exact detail write — never prefix-match. A `{ ...srv }` updater on
    // every `['servers', …]` query spreads Server[] into a non-array and
    // the list page then renders empty until a hard refresh.
    queryClient.setQueryData(qk.server(serverId), (srv: Server | undefined) =>
      srv ? { ...srv, status: nextStatus, lastExitCode: undefined } : srv,
    );
    patchServerListStatus(queryClient, serverId, nextStatus);
    return prevServer;
  }

  const start = useMutation({
    mutationFn: () => serversApi.start(serverId),
    onMutate: () => snapshotAndOptimistic(OPTIMISTIC_STATUS.start),
    onError: (_err, _vars, prev) => {
      if (prev) queryClient.setQueryData(qk.server(serverId), prev);
      optimisticInvalidate(queryClient, qk.servers());
      notifyError('Failed to start server');
    },
    onSettled: () => {
      optimisticInvalidate(queryClient, qk.server(serverId));
      optimisticInvalidate(queryClient, qk.servers());
      optimisticInvalidate(queryClient, qk.adminServers());
    },
  });

  const stop = useMutation({
    mutationFn: () => serversApi.stop(serverId),
    onMutate: () => snapshotAndOptimistic(OPTIMISTIC_STATUS.stop),
    onError: (_err, _vars, prev) => {
      if (prev) queryClient.setQueryData(qk.server(serverId), prev);
      optimisticInvalidate(queryClient, qk.servers());
      notifyError('Failed to stop server');
    },
    onSettled: () => {
      optimisticInvalidate(queryClient, qk.server(serverId));
      optimisticInvalidate(queryClient, qk.servers());
      optimisticInvalidate(queryClient, qk.adminServers());
    },
  });

  const restart = useMutation({
    mutationFn: () => serversApi.restart(serverId),
    onMutate: () => snapshotAndOptimistic(OPTIMISTIC_STATUS.restart),
    onError: (_err, _vars, prev) => {
      if (prev) queryClient.setQueryData(qk.server(serverId), prev);
      optimisticInvalidate(queryClient, qk.servers());
      notifyError('Failed to restart server');
    },
    onSettled: () => {
      optimisticInvalidate(queryClient, qk.server(serverId));
      optimisticInvalidate(queryClient, qk.servers());
      optimisticInvalidate(queryClient, qk.adminServers());
    },
  });

  const kill = useMutation({
    mutationFn: () => serversApi.kill(serverId),
    onMutate: () => snapshotAndOptimistic(OPTIMISTIC_STATUS.kill),
    onError: (_err, _vars, prev) => {
      if (prev) queryClient.setQueryData(qk.server(serverId), prev);
      optimisticInvalidate(queryClient, qk.servers());
      notifyError('Failed to kill server');
      setShowKillConfirm(false);
    },
    onSettled: () => {
      optimisticInvalidate(queryClient, qk.server(serverId));
      optimisticInvalidate(queryClient, qk.servers());
      optimisticInvalidate(queryClient, qk.adminServers());
    },
    onSuccess: () => {
      notifySuccess('Server killed');
      setShowKillConfirm(false);
    },
  });

  if (!canStart && !canStop && !canKill) {
    return null;
  }

  const busy = start.isPending || stop.isPending || restart.isPending || kill.isPending;

  return (
    <>
      <div className="flex flex-wrap gap-1.5 text-xs">
        {canStart && (
          <Button
            size="sm"
            className="bg-success text-success-foreground hover:bg-success/90"
            disabled={busy || !STARTABLE.includes(status)}
            aria-busy={start.isPending}
            onClick={() => start.mutate()}
          >
            {start.isPending ? 'Starting…' : 'Start'}
          </Button>
        )}
        {canStop && (
          <Button
            size="sm"
            variant="secondary"
            disabled={busy || !STOPPABLE.includes(status)}
            aria-busy={stop.isPending}
            onClick={() => stop.mutate()}
          >
            {stop.isPending ? 'Stopping…' : 'Stop'}
          </Button>
        )}
        {canRestart && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy || !RESTARTABLE.includes(status)}
            aria-busy={restart.isPending}
            onClick={() => restart.mutate()}
          >
            {restart.isPending ? 'Restarting…' : 'Restart'}
          </Button>
        )}
        {canKill && (
          <Button
            size="sm"
            variant="destructive"
            disabled={busy || !KILLABLE.includes(status)}
            aria-busy={kill.isPending}
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

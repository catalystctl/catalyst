import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { serversApi } from '../../services/api/servers';
import { qk } from '../../lib/queryKeys';
import { queryClient } from '../../lib/queryClient';
import { optimisticSet, optimisticInvalidate } from '../../lib/queryUtils';
import { notifyError, notifySuccess } from '../../utils/notify';
import { ConfirmDialog } from '../shared/ConfirmDialog';
import { Button } from '@/components/ui/button';
import type { Server, ServerStatus } from '../../types/server';

type Props = {
  serverId: string;
  status: ServerStatus;
  permissions?: string[];
};

// Map action → target status for optimistic updates
const OPTIMISTIC_STATUS: Record<string, ServerStatus> = {
  start: 'starting',
  stop: 'stopping',
  restart: 'restarting',
  kill: 'killed',
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

  /** Snapshot + optimistic update + return snapshot key for rollback */
  function snapshotAndOptimistic(nextStatus: ServerStatus) {
    optimisticSet(queryClient, qk.server(serverId), (srv: Server) =>
      srv ? { ...srv, status: nextStatus, lastExitCode: undefined } : srv,
    );
    optimisticSet(queryClient, qk.servers(), (servers: Server[]) =>
      Array.isArray(servers)
        ? servers.map((s) => (s.id === serverId || s.uuid === serverId ? { ...s, status: nextStatus } : s))
        : servers,
    );
  }

  const start = useMutation({
    mutationFn: () => serversApi.start(serverId),
    onMutate: () => {
      snapshotAndOptimistic(OPTIMISTIC_STATUS.start);
    },
    onError: (_err, _vars, prev) => {
      queryClient.setQueryData(qk.server(serverId), prev as any);
      queryClient.setQueryData(
        qk.servers(),
        (servers: Server[]) =>
          Array.isArray(servers)
            ? servers.map((s) => (s.id === serverId || s.uuid === serverId ? { ...s, status } : s))
            : servers,
      );
      notifyError('Failed to start server');
    },
    onSettled: () => {
      optimisticInvalidate(queryClient, qk.server(serverId));
      optimisticInvalidate(queryClient, qk.servers());
    },
  });

  const stop = useMutation({
    mutationFn: () => serversApi.stop(serverId),
    onMutate: () => {
      snapshotAndOptimistic(OPTIMISTIC_STATUS.stop);
    },
    onError: (_err, _vars, prev) => {
      queryClient.setQueryData(qk.server(serverId), prev as any);
      queryClient.setQueryData(
        qk.servers(),
        (servers: Server[]) =>
          Array.isArray(servers)
            ? servers.map((s) => (s.id === serverId || s.uuid === serverId ? { ...s, status } : s))
            : servers,
      );
      notifyError('Failed to stop server');
    },
    onSettled: () => {
      optimisticInvalidate(queryClient, qk.server(serverId));
      optimisticInvalidate(queryClient, qk.servers());
    },
  });

  const restart = useMutation({
    mutationFn: () => serversApi.restart(serverId),
    onMutate: () => {
      snapshotAndOptimistic(OPTIMISTIC_STATUS.restart);
    },
    onError: (_err, _vars, prev) => {
      queryClient.setQueryData(qk.server(serverId), prev as any);
      queryClient.setQueryData(
        qk.servers(),
        (servers: Server[]) =>
          Array.isArray(servers)
            ? servers.map((s) => (s.id === serverId || s.uuid === serverId ? { ...s, status } : s))
            : servers,
      );
      notifyError('Failed to restart server');
    },
    onSettled: () => {
      optimisticInvalidate(queryClient, qk.server(serverId));
      optimisticInvalidate(queryClient, qk.servers());
    },
  });

  const kill = useMutation({
    mutationFn: () => serversApi.kill(serverId),
    onMutate: () => {
      snapshotAndOptimistic(OPTIMISTIC_STATUS.kill);
    },
    onError: (_err, _vars, prev) => {
      queryClient.setQueryData(qk.server(serverId), prev as any);
      queryClient.setQueryData(
        qk.servers(),
        (servers: Server[]) =>
          Array.isArray(servers)
            ? servers.map((s) => (s.id === serverId || s.uuid === serverId ? { ...s, status } : s))
            : servers,
      );
      notifyError('Failed to kill server');
      setShowKillConfirm(false);
    },
    onSettled: () => {
      optimisticInvalidate(queryClient, qk.server(serverId));
      optimisticInvalidate(queryClient, qk.servers());
    },
    onSuccess: () => {
      notifySuccess('Server killed');
      setShowKillConfirm(false);
    },
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

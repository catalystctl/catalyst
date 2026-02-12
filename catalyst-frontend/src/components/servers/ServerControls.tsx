import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { serversApi } from '../../services/api/servers';
import { notifyError, notifySuccess } from '../../utils/notify';
import { ConfirmDialog } from '../shared/ConfirmDialog';
import type { ServerStatus } from '../../types/server';

type Props = {
  serverId: string;
  status: ServerStatus;
};

function ServerControls({ serverId, status }: Props) {
  const queryClient = useQueryClient();
  const isSuspended = status === 'suspended';
  const [showKillConfirm, setShowKillConfirm] = useState(false);

  const invalidate = () =>
    queryClient.invalidateQueries({
      predicate: (query) => Array.isArray(query.queryKey) && query.queryKey[0] === 'servers',
    });

  const start = useMutation({
    mutationFn: () => serversApi.start(serverId),
    onSuccess: () => {
      invalidate();
      notifySuccess('Server started');
    },
    onError: () => notifyError('Failed to start server'),
  });
  const stop = useMutation({
    mutationFn: () => serversApi.stop(serverId),
    onSuccess: () => {
      invalidate();
      notifySuccess('Server stopped');
    },
    onError: () => notifyError('Failed to stop server'),
  });
  const restart = useMutation({
    mutationFn: () => serversApi.restart(serverId),
    onSuccess: () => {
      invalidate();
      notifySuccess('Server restarted');
    },
    onError: () => notifyError('Failed to restart server'),
  });
  const kill = useMutation({
    mutationFn: () => serversApi.kill(serverId),
    onSuccess: () => {
      invalidate();
      notifySuccess('Server killed');
      setShowKillConfirm(false);
    },
    onError: () => {
      notifyError('Failed to kill server');
      setShowKillConfirm(false);
    },
  });

  const handleKillConfirm = () => {
    kill.mutate();
  };

  return (
    <>
      <div className="flex flex-wrap gap-2 text-xs">
        <button
          className="rounded-md bg-emerald-600 px-3 py-1 font-semibold text-white shadow-lg shadow-emerald-500/20 transition-all duration-300 hover:bg-emerald-500 disabled:opacity-60"
          disabled={start.isPending || status === 'running' || isSuspended}
          onClick={() => start.mutate()}
        >
          Start
        </button>
        <button
          className="rounded-md bg-slate-600 px-3 py-1 font-semibold text-white shadow-lg shadow-slate-500/20 transition-all duration-300 hover:bg-slate-500 disabled:opacity-60"
          disabled={stop.isPending || status === 'stopped' || isSuspended}
          onClick={() => stop.mutate()}
        >
          Stop
        </button>
        <button
          className="rounded-md bg-primary-600 px-3 py-1 font-semibold text-white shadow-lg shadow-primary-500/20 transition-all duration-300 hover:bg-primary-500 disabled:opacity-60"
          disabled={restart.isPending || isSuspended}
          onClick={() => restart.mutate()}
        >
          Restart
        </button>
        <button
          className="rounded-md bg-rose-600 px-3 py-1 font-semibold text-white shadow-lg shadow-rose-500/20 transition-all duration-300 hover:bg-rose-500 disabled:opacity-60"
          disabled={kill.isPending || isSuspended || status === 'stopped'}
          onClick={() => setShowKillConfirm(true)}
        >
          Kill
        </button>
      </div>

      <ConfirmDialog
        open={showKillConfirm}
        title="Kill server?"
        message="This will force-terminate the server process immediately without saving. Data may be lost. Are you sure?"
        confirmText="Kill"
        cancelText="Cancel"
        variant="danger"
        loading={kill.isPending}
        onConfirm={handleKillConfirm}
        onCancel={() => setShowKillConfirm(false)}
      />
    </>
  );
}

export default ServerControls;

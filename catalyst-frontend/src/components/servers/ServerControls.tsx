import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@/csync';
import { serversApi } from '../../services/api/servers';
import { qk } from '../../lib/queryKeys';

import { optimisticInvalidate, patchServerListStatus } from '../../lib/queryUtils';
import { notifyError, notifySuccess } from '../../utils/notify';
import { ConfirmDialog } from '../shared/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { agentApi } from '../../services/api/agent';
import { getApiErrorCode } from '../../i18n/api-errors';
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
  const { t } = useTranslation('servers');
  const queryClient = useQueryClient();
  const [showKillConfirm, setShowKillConfirm] = useState(false);
  const [showCancelInstallConfirm, setShowCancelInstallConfirm] = useState(false);
  // Node whose host networking must be enabled before this server can start.
  const [hostNetworkNodeId, setHostNetworkNodeId] = useState<string | null>(null);

  // Fail CLOSED: missing/empty permissions hide all power controls.
  const p = new Set(permissions ?? []);
  const hasWildcard = p.has('*');
  const canStart = hasWildcard || p.has('server.start');
  const canStop = hasWildcard || p.has('server.stop');
  const canRestart = canStart && canStop;
  const canKill = canStop;
  const canCancelInstall =
    hasWildcard || p.has('server.install') || p.has('server.reinstall');

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
    onError: (err, _vars, prev) => {
      if (prev) queryClient.setQueryData(qk.server(serverId), prev);
      optimisticInvalidate(queryClient, qk.servers());
      // The node denies host networking: offer to enable it instead of a
      // dead-end error. Requires node.update; the API answers 403 otherwise.
      if (getApiErrorCode(err) === 'HOST_NETWORK_DISABLED') {
        const srv = queryClient.getQueryData<Server>(qk.server(serverId));
        if (srv?.nodeId) {
          setHostNetworkNodeId(srv.nodeId);
          return;
        }
      }
      notifyError(err);
    },
    onSettled: () => {
      optimisticInvalidate(queryClient, qk.server(serverId));
      optimisticInvalidate(queryClient, qk.servers());
      optimisticInvalidate(queryClient, qk.adminServers());
    },
  });

  const enableHostNetwork = useMutation({
    mutationFn: (nodeId: string) => agentApi.setHostNetwork(nodeId, true),
    onSuccess: (_result, nodeId) => {
      setHostNetworkNodeId(null);
      notifySuccess(t('hostNetwork.enabled'));
      optimisticInvalidate(queryClient, qk.node(nodeId));
      // Retry the start now that the node accepts host networking.
      start.mutate();
    },
    onError: (err) => {
      setHostNetworkNodeId(null);
      notifyError(err);
    },
  });

  const stop = useMutation({
    mutationFn: () => serversApi.stop(serverId),
    onMutate: () => snapshotAndOptimistic(OPTIMISTIC_STATUS.stop),
    onError: (err, _vars, prev) => {
      if (prev) queryClient.setQueryData(qk.server(serverId), prev);
      optimisticInvalidate(queryClient, qk.servers());
      notifyError(err);
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
    onError: (err, _vars, prev) => {
      if (prev) queryClient.setQueryData(qk.server(serverId), prev);
      optimisticInvalidate(queryClient, qk.servers());
      notifyError(err);
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
    onError: (err, _vars, prev) => {
      if (prev) queryClient.setQueryData(qk.server(serverId), prev);
      optimisticInvalidate(queryClient, qk.servers());
      notifyError(err);
      setShowKillConfirm(false);
    },
    onSettled: () => {
      optimisticInvalidate(queryClient, qk.server(serverId));
      optimisticInvalidate(queryClient, qk.servers());
      optimisticInvalidate(queryClient, qk.adminServers());
    },
    onSuccess: () => {
      notifySuccess(t('controls.serverKilled'));
      setShowKillConfirm(false);
    },
  });

  const cancelInstall = useMutation({
    mutationFn: () => serversApi.cancelInstall(serverId),
    onMutate: () => snapshotAndOptimistic('stopped'),
    onError: (err, _vars, prev) => {
      if (prev) queryClient.setQueryData(qk.server(serverId), prev);
      optimisticInvalidate(queryClient, qk.servers());
      notifyError(err);
      setShowCancelInstallConfirm(false);
    },
    onSettled: () => {
      optimisticInvalidate(queryClient, qk.server(serverId));
      optimisticInvalidate(queryClient, qk.servers());
      optimisticInvalidate(queryClient, qk.adminServers());
    },
    onSuccess: () => {
      notifySuccess(t('controls.installCancelled'));
      setShowCancelInstallConfirm(false);
    },
  });

  if (!canStart && !canStop && !canKill && !canCancelInstall) {
    return null;
  }

  const busy =
    start.isPending ||
    stop.isPending ||
    restart.isPending ||
    kill.isPending ||
    cancelInstall.isPending ||
    enableHostNetwork.isPending;

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
            {start.isPending ? t('controls.starting') : t('controls.start')}
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
            {stop.isPending ? t('controls.stopping') : t('controls.stop')}
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
            {restart.isPending ? t('controls.restarting') : t('controls.restart')}
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
            {t('controls.kill')}
          </Button>
        )}
        {canCancelInstall && status === 'installing' && (
          <Button
            size="sm"
            variant="destructive"
            disabled={busy}
            aria-busy={cancelInstall.isPending}
            onClick={() => setShowCancelInstallConfirm(true)}
          >
            {cancelInstall.isPending ? t('controls.cancelling') : t('controls.cancelInstall')}
          </Button>
        )}
      </div>

      <ConfirmDialog
        open={showKillConfirm}
        title={t('controls.killConfirmTitle')}
        message={t('controls.killConfirmMessage')}
        confirmText={t('controls.kill')}
        cancelText={t('common:actions.cancel')}
        variant="danger"
        loading={kill.isPending}
        onConfirm={() => kill.mutate()}
        onCancel={() => setShowKillConfirm(false)}
      />
      <ConfirmDialog
        open={showCancelInstallConfirm}
        title={t('controls.cancelInstallConfirmTitle')}
        message={t('controls.cancelInstallConfirmMessage')}
        confirmText={t('controls.cancelInstall')}
        cancelText={t('controls.keepInstalling')}
        variant="danger"
        loading={cancelInstall.isPending}
        onConfirm={() => cancelInstall.mutate()}
        onCancel={() => setShowCancelInstallConfirm(false)}
      />
      <ConfirmDialog
        open={hostNetworkNodeId !== null}
        title={t('hostNetwork.title')}
        message={t('hostNetwork.message')}
        confirmText={t('hostNetwork.confirm')}
        cancelText={t('common:actions.cancel')}
        variant="warning"
        loading={enableHostNetwork.isPending}
        onConfirm={() => hostNetworkNodeId && enableHostNetwork.mutate(hostNetworkNodeId)}
        onCancel={() => setHostNetworkNodeId(null)}
      />
    </>
  );
}

export default ServerControls;

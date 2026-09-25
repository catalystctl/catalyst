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
import { Play, Square, RotateCw, OctagonX, Ban } from 'lucide-react';
import { cn } from '@/lib/utils';

type Props = {
  serverId: string;
  status: ServerStatus;
  permissions?: string[];
  /** Dense surfaces (browser rows) render icon-only controls. */
  compact?: boolean;
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

function ServerControls({ serverId, status, permissions, compact = false }: Props) {
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

  const actions = [
    canStart && {
      key: 'start',
      show: true,
      label: start.isPending ? t('controls.starting') : t('controls.start'),
      icon: Play,
      className: 'bg-success text-success-foreground hover:bg-success/90',
      disabled: busy || !STARTABLE.includes(status),
      pending: start.isPending,
      onClick: () => start.mutate(),
    },
    canStop && {
      key: 'stop',
      show: true,
      label: stop.isPending ? t('controls.stopping') : t('controls.stop'),
      icon: Square,
      variant: 'secondary' as const,
      disabled: busy || !STOPPABLE.includes(status),
      pending: stop.isPending,
      onClick: () => stop.mutate(),
    },
    canRestart && {
      key: 'restart',
      show: true,
      label: restart.isPending ? t('controls.restarting') : t('controls.restart'),
      icon: RotateCw,
      variant: 'outline' as const,
      disabled: busy || !RESTARTABLE.includes(status),
      pending: restart.isPending,
      onClick: () => restart.mutate(),
    },
    canKill && {
      key: 'kill',
      show: true,
      label: t('controls.kill'),
      icon: OctagonX,
      variant: 'destructive' as const,
      disabled: busy || !KILLABLE.includes(status),
      pending: kill.isPending,
      onClick: () => setShowKillConfirm(true),
    },
    canCancelInstall && status === 'installing' && {
      key: 'cancel-install',
      show: true,
      label: cancelInstall.isPending ? t('controls.cancelling') : t('controls.cancelInstall'),
      icon: Ban,
      variant: 'destructive' as const,
      disabled: busy,
      pending: cancelInstall.isPending,
      onClick: () => setShowCancelInstallConfirm(true),
    },
  ].filter(Boolean) as {
    key: string;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    className?: string;
    variant?: 'secondary' | 'outline' | 'destructive';
    disabled: boolean;
    pending: boolean;
    onClick: () => void;
  }[];

  return (
    <>
      <div className={cn(compact ? 'flex items-center gap-1' : 'flex flex-wrap gap-1.5 text-xs')}>
        {actions.map((action) => {
          const Icon = action.icon;
          return (
            <Button
              key={action.key}
              size={compact ? 'icon-sm' : 'sm'}
              variant={compact ? (action.variant ?? 'default') : action.variant}
              className={action.className}
              disabled={action.disabled}
              aria-busy={action.pending}
              aria-label={compact ? action.label : undefined}
              title={compact ? action.label : undefined}
              onClick={action.onClick}
            >
              {compact ? <Icon className="h-3.5 w-3.5" /> : action.label}
            </Button>
          );
        })}
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

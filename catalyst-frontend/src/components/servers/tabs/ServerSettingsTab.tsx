import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import ServerTabCard from './ServerTabCard';
import TabHeader from './TabHeader';
import { useQueryClient } from '@/csync';
import { qk } from '../../../lib/queryKeys';
import { serversApi } from '../../../services/api/servers';
import { notifySuccess, notifyError } from '../../../utils/notify';
import { reportSystemError } from '../../../services/api/systemErrors';
import { describeError } from '../../../utils/errors';
import CloneServerDialog from '../CloneServerDialog';
import { ConfirmDialog } from '../../shared/ConfirmDialog';
import type { Server } from '../../../types/server';
import { Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import SettingsRow from './SettingsRow';


interface Props {
 serverId: string;
 serverName: string;
 onServerNameChange: (name: string) => void;
 renamePending: boolean;
 onRename: () => void;
 isSuspended: boolean;
 serverStatus: string;
 server: Server;
 /** Effective server permissions used to gate reinstall. */
 permissions?: string[];
}

export default function ServerSettingsTab({
 serverId,
 serverName,
 onServerNameChange,
 renamePending,
 onRename,
 isSuspended,
 serverStatus,
 server,
 permissions,
}: Props) {
 const { t } = useTranslation('server-tabs');
 const queryClient = useQueryClient();
 const [showReinstallConfirm, setShowReinstallConfirm] = useState(false);
 const [reinstallPending, setReinstallPending] = useState(false);
 const [showCancelInstallConfirm, setShowCancelInstallConfirm] = useState(false);
 const [cancelInstallPending, setCancelInstallPending] = useState(false);

 const permSet = new Set(permissions ?? []);
 const canReinstall =
   permSet.has('*') ||
   permSet.has('server.install') ||
   permSet.has('server.reinstall');
 const isInstalling = serverStatus === 'installing';

 const handleReinstall = async () => {
 setReinstallPending(true);
 try {
 await serversApi.install(serverId);
 notifySuccess(t('tabs.settings.reinstallStarted'));
 setShowReinstallConfirm(false);
 } catch (error: unknown) {
 reportSystemError({
 level: 'error',
 component: 'ServerSettingsTab',
 message: describeError(error),
 stack: error instanceof Error ? error.stack : undefined,
 metadata: { context: 'reinstall server' },
 });
 notifyError(error instanceof Error ? error.message : t('tabs.settings.reinstallFailed'));
 } finally {
 setReinstallPending(false);
 queryClient.invalidateQueries({ queryKey: qk.server(serverId) });
 queryClient.invalidateQueries({ queryKey: qk.servers() });
 }
 };

 const handleCancelInstall = async () => {
 setCancelInstallPending(true);
 try {
 await serversApi.cancelInstall(serverId);
 notifySuccess(t('tabs.settings.installCancelled'));
 setShowCancelInstallConfirm(false);
 } catch (error: unknown) {
 reportSystemError({
 level: 'error',
 component: 'ServerSettingsTab',
 message: describeError(error),
 stack: error instanceof Error ? error.stack : undefined,
 metadata: { context: 'cancel install' },
 });
 notifyError(error instanceof Error ? error.message : t('tabs.settings.cancelInstallFailed'));
 } finally {
 setCancelInstallPending(false);
 queryClient.invalidateQueries({ queryKey: qk.server(serverId) });
 queryClient.invalidateQueries({ queryKey: qk.servers() });
 }
 };

 return (
 <div className="space-y-4">
 <TabHeader
 icon={Settings}
 title={t('tabs.settings.title')}
 description={t('tabs.settings.description')}
 />
    <ServerTabCard>
      <SettingsRow label={t('shared.name')} description={t('tabs.settings.nameDescription')}>
        <Input
          className="min-w-[160px]"
          value={serverName}
          onChange={(e) => onServerNameChange(e.target.value)}
          placeholder={t('tabs.settings.namePlaceholder')}
          disabled={isSuspended}
        />
        <Button type="button" size="sm" onClick={onRename} disabled={renamePending || isSuspended || !serverName.trim()}>
          {t('common:actions.save')}
        </Button>
      </SettingsRow>
      <SettingsRow label={t('tabs.settings.maintenance')}>
        {canReinstall && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="border-warning/30 text-warning hover:bg-warning/10"
            disabled={serverStatus !== 'stopped' || isSuspended || reinstallPending}
            onClick={() => setShowReinstallConfirm(true)}
          >
            {t('tabs.settings.reinstall')}
          </Button>
        )}
        {canReinstall && isInstalling && (
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={isSuspended || cancelInstallPending}
            onClick={() => setShowCancelInstallConfirm(true)}
          >
            {cancelInstallPending ? t('tabs.settings.cancelling') : t('tabs.settings.cancelInstall')}
          </Button>
        )}
        <CloneServerDialog server={server} disabled={isSuspended} />
      </SettingsRow>
    </ServerTabCard>



 <ConfirmDialog
 open={showReinstallConfirm}
 title={t('tabs.settings.reinstallConfirmTitle')}
 message={t('tabs.settings.reinstallConfirmMessage')}
 confirmText={t('tabs.settings.reinstall')}
 cancelText={t('common:actions.cancel')}
 variant="danger"
 loading={reinstallPending}
 onConfirm={() => { void handleReinstall(); }}
 onCancel={() => setShowReinstallConfirm(false)}
 />
 <ConfirmDialog
 open={showCancelInstallConfirm}
 title={t('tabs.settings.cancelInstallConfirmTitle')}
 message={t('tabs.settings.cancelInstallConfirmMessage')}
 confirmText={t('tabs.settings.cancelInstall')}
 cancelText={t('tabs.settings.keepInstalling')}
 variant="danger"
 loading={cancelInstallPending}
 onConfirm={() => { void handleCancelInstall(); }}
 onCancel={() => setShowCancelInstallConfirm(false)}
 />
 </div>
 );
}

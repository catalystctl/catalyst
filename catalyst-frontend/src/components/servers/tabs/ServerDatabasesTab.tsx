import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import ServerTabCard from './ServerTabCard';

import TabHeader from './TabHeader';
import TabEmptyState from './TabEmptyState';
import TabLoadingState from './TabLoadingState';
import TabErrorState from './TabErrorState';
import DataField from './DataField';
import { ConfirmDialog } from '../../shared/ConfirmDialog';
import { Database } from 'lucide-react';

interface DatabaseHost {
 id: string;
 name: string;
 host: string;
 port: number;
}

interface Database {
 id: string;
 name: string;
 hostName: string;
 host: string;
 port: number;
 username: string;
 password: string;
}

interface Props {
 isSuspended: boolean;
 databases: Database[];
 databasesLoading: boolean;
 databasesError: boolean;
 databaseHosts: DatabaseHost[];
 databaseAllocation: number;
 canManageDatabases: boolean;
 databaseHostId: string;
 onDatabaseHostIdChange: (id: string) => void;
 databaseName: string;
 onDatabaseNameChange: (name: string) => void;
 createPending: boolean;
 onCreate: () => void;
 rotatePending: boolean;
 onRotate: (databaseId: string) => void;
 deletePending: boolean;
 onDelete: (databaseId: string) => void;
}

export default function ServerDatabasesTab({
 isSuspended,
 databases: databasesProp,
 databasesLoading,
 databasesError,
 databaseHosts: hostsProp,
 databaseAllocation,
 canManageDatabases,
 databaseHostId,
 onDatabaseHostIdChange,
 databaseName,
 onDatabaseNameChange,
 createPending,
 onCreate,
 rotatePending,
 onRotate,
 deletePending,
 onDelete,
}: Props) {
 const { t } = useTranslation('server-tabs');
 const databases = Array.isArray(databasesProp) ? databasesProp : [];
 const databaseHosts = Array.isArray(hostsProp) ? hostsProp : [];
 const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
 const databaseLimitReached =
 databaseAllocation > 0 && databases.length >= databaseAllocation;
 const disabled = isSuspended || databaseAllocation === 0;
 const pendingDeleteDb = databases.find((db) => db.id === pendingDeleteId);

 return (
 <div className="space-y-4">
 <TabHeader
 icon={Database}
 title={t('tabs.databases.title')}
 description={
 databaseAllocation === 0
 ? t('tabs.databases.allocationDisabled')
 : t('tabs.databases.used', {
 used: databases.length,
 total: databaseAllocation,
 })
 }
 actions={
 canManageDatabases ? (
 <div className="flex flex-wrap items-center gap-2 text-xs">
 <select
 className="rounded-md border border-border/40 bg-card px-2 py-1.5 text-xs text-foreground transition-colors focus:border-primary focus:outline-none"
 value={databaseHostId}
 onChange={(e) => onDatabaseHostIdChange(e.target.value)}
 disabled={disabled}
 >
 <option value="">{t('tabs.databases.selectHost')}</option>
 {databaseHosts.map((host) => (
 <option key={host.id} value={host.id}>
 {host.name} ({host.host}:{host.port})
 </option>
 ))}
 </select>
 <input
 className="rounded-md border border-border/40 bg-card px-2 py-1.5 font-mono text-xs text-foreground transition-colors focus:border-primary focus:outline-none"
 value={databaseName}
 onChange={(e) => onDatabaseNameChange(e.target.value)}
 placeholder="database_name"
 disabled={disabled}
 />
 <button
 type="button"
 className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-all hover:bg-primary/90 disabled:opacity-50"
 onClick={onCreate}
 disabled={!databaseHostId || createPending || disabled || databaseLimitReached}
 >
 {t('common:actions.create')}
 </button>
 </div>
 ) : undefined
 }
 />

 <ServerTabCard>
 {databaseAllocation === 0 && (
 <div className="rounded-lg border border-warning/20 bg-warning/5 px-3 py-2.5 text-[11px] text-warning">
 {t('tabs.databases.allocationUnavailable')}
 </div>
 )}

 {databasesLoading ? (
 <TabLoadingState rows={2} />
 ) : databasesError ? (
 <TabErrorState message={t('tabs.databases.loadFailed')} />
 ) : databases.length === 0 ? (
 <TabEmptyState
 title={t('tabs.databases.emptyTitle')}
 description={t('tabs.databases.emptyDescription')}
 />
 ) : (
 <div className="space-y-2">
 {databases.map((db) => (
 <div
 key={db.id}
 className="group relative rounded-lg border border-border/30 px-4 py-3 transition-all duration-150 hover:border-primary/20 hover:bg-primary/[0.02]"
 >
 <div className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-primary/0 transition-colors duration-150 group-hover:bg-primary/50" />

 <div className="flex flex-wrap items-center justify-between gap-3">
 <div>
 <div className="font-mono text-sm font-semibold text-foreground">
 {db.name}
 </div>
 <div className="mt-0.5 text-[10px] text-muted-foreground/50">
 {db.hostName} · {db.host}:{db.port}
 </div>
 </div>
 {canManageDatabases && (
 <div className="flex items-center gap-1.5">
 <button
 type="button"
 className="rounded-md border border-border/30 px-2 py-1 text-[10px] font-medium text-muted-foreground transition-all hover:border-primary/20 hover:text-foreground disabled:opacity-50"
 onClick={() => onRotate(db.id)}
 disabled={rotatePending || isSuspended}
 >
 {t('tabs.databases.rotate')}
 </button>
 <button
 type="button"
 className="rounded-md border border-danger/20 px-2 py-1 text-[10px] font-medium text-danger transition-all hover:border-danger/40 hover:bg-danger/5 disabled:opacity-50"
 onClick={() => setPendingDeleteId(db.id)}
 disabled={deletePending || isSuspended}
 >
 {t('common:actions.delete')}
 </button>
 </div>
 )}
 </div>
 <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-3">
 <DataField label={t('tabs.databases.fields.database')} value={db.name} copyable concealable />
 <DataField label={t('tabs.databases.fields.username')} value={db.username} copyable />
 <DataField label={t('tabs.databases.fields.password')} value={db.password} concealable />
 </div>
 </div>
 ))}
 </div>
 )}
 </ServerTabCard>

 <ConfirmDialog
 open={Boolean(pendingDeleteId)}
 title={t('tabs.databases.deleteTitle')}
 message={
 pendingDeleteDb
 ? t('tabs.databases.deleteConfirm', { name: pendingDeleteDb.name })
 : t('tabs.databases.deleteConfirmFallback')
 }
 confirmText={t('common:actions.delete')}
 cancelText={t('common:actions.cancel')}
 variant="danger"
 loading={deletePending}
 onConfirm={() => {
 if (!pendingDeleteId) return;
 onDelete(pendingDeleteId);
 setPendingDeleteId(null);
 }}
 onCancel={() => setPendingDeleteId(null)}
 />
 </div>
 );
}

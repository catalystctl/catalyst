import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import ServerTabCard from './ServerTabCard';

import TabHeader from './TabHeader';
import TabEmptyState from './TabEmptyState';
import TabLoadingState from './TabLoadingState';
import TabErrorState from './TabErrorState';
import DataField from './DataField';
import { ConfirmDialog } from '../../shared/ConfirmDialog';
import DatabaseCredentialsDialog from './DatabaseCredentialsDialog';
import type { ServerDatabase } from '../../../types/database';
import { Database } from 'lucide-react';

interface DatabaseHost {
 id: string;
 name: string;
 host: string;
 port: number;
}

interface Props {
 isSuspended: boolean;
 databases: ServerDatabase[];
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
 revealedCredentials: ServerDatabase | null;
 onDismissRevealedCredentials: () => void;
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
 revealedCredentials,
 onDismissRevealedCredentials,
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
 <div className="flex flex-wrap items-center gap-2">
 <select
 className="h-7 rounded-sm border border-border/60 bg-background/40 pl-2 pr-7 text-mini text-foreground outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary/40"
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
 className="h-7 rounded-sm border border-border/60 bg-background/40 px-2 font-mono text-mini text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary/40"
 value={databaseName}
 onChange={(e) => onDatabaseNameChange(e.target.value)}
 placeholder="database_name"
 disabled={disabled}
 />
 <button
 type="button"
 className="h-8 rounded-sm bg-primary px-3 text-mini font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
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
 <div className="mb-2 rounded-sm border border-warning/30 bg-warning/5 px-3 py-2 text-mini text-warning">
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
 <div>
 {databases.map((db) => (
 <div
 key={db.id}
 className="border-b border-border/50 py-3 last:border-0"
 >
 <div className="flex flex-wrap items-center justify-between gap-3">
 <div className="min-w-0">
 <div className="type-numeric truncate text-data text-foreground">
 {db.name}
 </div>
 <div className="mt-0.5 truncate font-mono text-micro text-muted-foreground">
 {db.hostName} · {db.host}:{db.port}
 </div>
 </div>
 {canManageDatabases && (
 <div className="flex items-center gap-1.5">
 <button
 type="button"
 className="h-7 rounded-sm border border-border/60 px-2.5 text-mini font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground disabled:opacity-50"
 onClick={() => onRotate(db.id)}
 disabled={rotatePending || isSuspended}
 >
 {t('tabs.databases.rotate')}
 </button>
 <button
 type="button"
 className="h-7 rounded-sm border border-danger/30 px-2.5 text-mini font-medium text-danger transition-colors hover:border-danger/50 hover:bg-danger/5 disabled:opacity-50"
 onClick={() => setPendingDeleteId(db.id)}
 disabled={deletePending || isSuspended}
 >
 {t('common:actions.delete')}
 </button>
 </div>
 )}
 </div>
 <div className="mt-1 grid grid-cols-1 gap-x-6 sm:grid-cols-3">
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

 {revealedCredentials && (
 <DatabaseCredentialsDialog
 credentials={revealedCredentials}
 onClose={onDismissRevealedCredentials}
 />
 )}
 </div>
 );
}

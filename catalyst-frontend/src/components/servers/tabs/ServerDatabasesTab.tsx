import ServerTabCard from './ServerTabCard';
import StatGrid from './StatGrid';
import TabHeader from './TabHeader';
import TabEmptyState from './TabEmptyState';
import TabLoadingState from './TabLoadingState';
import TabErrorState from './TabErrorState';
import DataField from './DataField';
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
  serverId: string;
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
  serverId,
  isSuspended,
  databases,
  databasesLoading,
  databasesError,
  databaseHosts,
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
  const databaseLimitReached =
    databaseAllocation > 0 && databases.length >= databaseAllocation;
  const disabled = isSuspended || databaseAllocation === 0;

  return (
    <div className="space-y-4">
      <TabHeader
        icon={Database}
        title="Databases"
        description={
          databaseAllocation === 0
            ? 'Database allocation disabled'
            : `${databases.length} / ${databaseAllocation} databases used`
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
                <option value="">Select host</option>
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
                className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground shadow-[0_0_6px_-1px_hsl(var(--primary)/0.2)] transition-all hover:bg-primary/90 disabled:opacity-50"
                onClick={onCreate}
                disabled={!databaseHostId || createPending || disabled || databaseLimitReached}
              >
                Create
              </button>
            </div>
          ) : undefined
        }
      />

      <ServerTabCard>
        {databaseAllocation === 0 && (
          <div className="rounded-lg border border-warning/20 bg-warning/5 px-3 py-2.5 text-[11px] text-warning">
            Database allocation is not available for this server.
          </div>
        )}

        {databasesLoading ? (
          <TabLoadingState rows={2} />
        ) : databasesError ? (
          <TabErrorState message="Unable to load databases." />
        ) : databases.length === 0 ? (
          <TabEmptyState
            title="No databases created"
            description="Create a database to store your server's data."
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
                        Rotate
                      </button>
                      <button
                        type="button"
                        className="rounded-md border border-danger/20 px-2 py-1 text-[10px] font-medium text-danger transition-all hover:border-danger/40 hover:bg-danger/5 disabled:opacity-50"
                        onClick={() => onDelete(db.id)}
                        disabled={deletePending || isSuspended}
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-3">
                  <DataField label="Database" value={db.name} copyable concealable />
                  <DataField label="Username" value={db.username} copyable />
                  <DataField label="Password" value={db.password} concealable />
                </div>
              </div>
            ))}
          </div>
        )}
      </ServerTabCard>
    </div>
  );
}

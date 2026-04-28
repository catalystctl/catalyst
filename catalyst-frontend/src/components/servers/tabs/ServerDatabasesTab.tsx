import { type ReactNode } from 'react';
import ServerTabCard from './ServerTabCard';
import StatGrid from './StatGrid';

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
    <ServerTabCard>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-foreground">Databases</div>
          <div className="text-xs text-muted-foreground">
            Create and manage per-server database credentials.
          </div>
          <div className="text-xs text-muted-foreground">
            Allocation:{' '}
            {databaseAllocation === 0
              ? 'Disabled'
              : `${databaseAllocation} databases`}
          </div>
        </div>
        {canManageDatabases ? (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <select
              className="rounded-lg border border-border bg-card px-2 py-1 text-xs text-foreground transition-all duration-300 focus:border-primary focus:outline-none"
              value={databaseHostId}
              onChange={(event) => onDatabaseHostIdChange(event.target.value)}
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
              className="rounded-lg border border-border bg-card px-2 py-1 text-xs text-foreground transition-all duration-300 focus:border-primary focus:outline-none"
              value={databaseName}
              onChange={(event) => onDatabaseNameChange(event.target.value)}
              placeholder="database_name"
              disabled={disabled}
            />
            <button
              type="button"
              className="rounded-md bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground shadow-lg shadow-primary/20 transition-all duration-300 hover:bg-primary/90 disabled:opacity-60"
              onClick={onCreate}
              disabled={
                !databaseHostId || createPending || disabled || databaseLimitReached
              }
            >
              Create
            </button>
            {databaseAllocation === 0 ? (
              <span className="text-xs text-warning">
                Database allocation disabled.
              </span>
            ) : databaseLimitReached ? (
              <span className="text-xs text-warning">
                Allocation limit reached.
              </span>
            ) : null}
          </div>
        ) : (
          <div className="text-xs text-muted-foreground">
            No database permissions assigned.
          </div>
        )}
      </div>

      {databaseAllocation === 0 ? (
        <div className="mt-3 rounded-xl border border-warning/30 bg-warning-muted px-4 py-3 text-xs text-warning">
          Provider database allocation is not available for this server. You
          cannot create a database until allocations are assigned.
        </div>
      ) : null}

      {databasesLoading ? (
        <div className="mt-4 text-sm text-muted-foreground">
          Loading databases...
        </div>
      ) : databasesError ? (
        <div className="mt-4 rounded-md border border-danger/30 bg-danger-muted px-3 py-2 text-xs text-danger">
          Unable to load databases.
        </div>
      ) : databases.length === 0 ? (
        <div className="mt-4 rounded-lg border border-dashed border-border bg-surface-2 px-6 py-8 text-center text-sm text-muted-foreground/50">
          No databases created yet.
        </div>
      ) : (
        <div className="mt-4 space-y-3 text-xs">
          {databases.map((database) => (
            <div
              key={database.id}
              className="rounded-lg border border-border bg-surface-2 px-4 py-3 transition-all duration-300 hover:border-primary/30"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-foreground">
                    {database.name}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Host: {database.hostName} ({database.host}:{database.port})
                  </div>
                </div>
                {canManageDatabases ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-all duration-300 hover:border-primary/30 hover:text-foreground disabled:opacity-60"
                      onClick={() => onRotate(database.id)}
                      disabled={rotatePending || isSuspended}
                    >
                      Rotate password
                    </button>
                    <button
                      type="button"
                      className="rounded-md border border-danger/30 px-2 py-1 text-xs text-danger transition-all duration-300 hover:border-danger/50 disabled:opacity-60"
                      onClick={() => onDelete(database.id)}
                      disabled={deletePending || isSuspended}
                    >
                      Delete
                    </button>
                  </div>
                ) : null}
              </div>
              <StatGrid
                columns={3}
                className="mt-3"
                items={[
                  { label: 'Database', value: database.name },
                  { label: 'Username', value: database.username },
                  { label: 'Password', value: database.password },
                ]}
              />
            </div>
          ))}
        </div>
      )}
    </ServerTabCard>
  );
}

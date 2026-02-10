import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import EmptyState from '../../components/shared/EmptyState';
import { adminApi } from '../../services/api/admin';
import { notifyError, notifySuccess } from '../../utils/notify';
import { useDatabaseHosts } from '../../hooks/useAdmin';

function DatabasePage() {
  const [dbHostId, setDbHostId] = useState<string | null>(null);
  const [dbName, setDbName] = useState('');
  const [dbHost, setDbHost] = useState('');
  const [dbPort, setDbPort] = useState('3306');
  const [dbUsername, setDbUsername] = useState('');
  const [dbPassword, setDbPassword] = useState('');
  const queryClient = useQueryClient();
  const { data: databaseHosts = [], isLoading } = useDatabaseHosts();

  const createHostMutation = useMutation({
    mutationFn: () =>
      adminApi.createDatabaseHost({
        name: dbName.trim(),
        host: dbHost.trim(),
        port: dbPort ? Number(dbPort) : undefined,
        username: dbUsername.trim(),
        password: dbPassword,
      }),
    onSuccess: () => {
      notifySuccess('Database host created');
      queryClient.invalidateQueries({ queryKey: ['admin-database-hosts'] });
      setDbName('');
      setDbHost('');
      setDbPort('3306');
      setDbUsername('');
      setDbPassword('');
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || 'Failed to create database host';
      notifyError(message);
    },
  });

  const updateHostMutation = useMutation({
    mutationFn: (payload: { hostId: string }) =>
      adminApi.updateDatabaseHost(payload.hostId, {
        name: dbName.trim(),
        host: dbHost.trim(),
        port: dbPort ? Number(dbPort) : undefined,
        username: dbUsername.trim(),
        password: dbPassword || undefined,
      }),
    onSuccess: () => {
      notifySuccess('Database host updated');
      queryClient.invalidateQueries({ queryKey: ['admin-database-hosts'] });
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || 'Failed to update database host';
      notifyError(message);
    },
  });

  const deleteHostMutation = useMutation({
    mutationFn: (hostId: string) => adminApi.deleteDatabaseHost(hostId),
    onSuccess: () => {
      notifySuccess('Database host removed');
      queryClient.invalidateQueries({ queryKey: ['admin-database-hosts'] });
      setDbHostId(null);
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || 'Failed to delete database host';
      notifyError(message);
    },
  });

  const canSubmitDbHost = useMemo(
    () => dbName.trim() && dbHost.trim() && dbUsername.trim() && dbPassword.trim(),
    [dbName, dbHost, dbUsername, dbPassword],
  );

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-surface-light transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:shadow-surface-dark dark:hover:border-primary-500/30">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Database</h1>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Manage database hosts for server provisioning.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs text-slate-600 dark:text-slate-400">
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 dark:border-slate-800 dark:bg-slate-950/60">
              {databaseHosts.length} hosts
            </span>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white px-6 py-5 shadow-surface-light dark:shadow-surface-dark transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-primary-500/30">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Database Hosts</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Register MySQL hosts used to provision per-server databases.
            </p>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
          <label className="block text-xs text-slate-500 dark:text-slate-300">
            Name
            <input
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
              value={dbName}
              onChange={(event) => setDbName(event.target.value)}
              placeholder="primary-mysql"
            />
          </label>
          <label className="block text-xs text-slate-500 dark:text-slate-300">
            Host
            <input
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
              value={dbHost}
              onChange={(event) => setDbHost(event.target.value)}
              placeholder="mysql.internal"
            />
          </label>
          <label className="block text-xs text-slate-500 dark:text-slate-300">
            Port
            <input
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
              value={dbPort}
              onChange={(event) => setDbPort(event.target.value)}
              placeholder="3306"
            />
          </label>
          <label className="block text-xs text-slate-500 dark:text-slate-300">
            Username
            <input
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
              value={dbUsername}
              onChange={(event) => setDbUsername(event.target.value)}
              placeholder="catalyst_admin"
            />
          </label>
          <label className="block text-xs text-slate-500 dark:text-slate-300">
            Password
            <input
              type="password"
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
              value={dbPassword}
              onChange={(event) => setDbPassword(event.target.value)}
              placeholder="secret"
            />
          </label>
        </div>
        <div className="mt-4 flex justify-end">
          <button
            className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-primary-500/20 transition-all duration-300 hover:bg-primary-500 disabled:opacity-60"
            disabled={!canSubmitDbHost || createHostMutation.isPending}
            onClick={() => createHostMutation.mutate()}
          >
            Create host
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Active hosts</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            View connection details and manage existing database hosts.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {isLoading ? (
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-6 text-slate-600 shadow-surface-light dark:shadow-surface-dark transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-primary-500/30">
            Loading database hosts...
          </div>
        ) : databaseHosts.length === 0 ? (
          <EmptyState
            title="No database hosts yet"
            description="Create a host to provision databases for servers."
          />
        ) : (
          databaseHosts.map((dbHostEntry) => (
            <div
              key={dbHostEntry.id}
              className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-surface-light dark:shadow-surface-dark transition-all duration-300 hover:-translate-y-1 hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-primary-500/30"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {dbHostEntry.name}
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 dark:text-slate-500">
                    {dbHostEntry.host}:{dbHostEntry.port}
                  </div>
                  <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                    User: {dbHostEntry.username}
                  </div>
                </div>
                <div className="flex gap-2 text-xs">
                  <button
                    className="rounded-md border border-slate-200 px-2 py-1 text-slate-600 transition-all duration-300 hover:border-primary-500 hover:text-slate-900 dark:border-slate-800 dark:text-slate-300 dark:hover:border-primary-500/30"
                    onClick={() => {
                      setDbHostId(dbHostEntry.id);
                      setDbName(dbHostEntry.name);
                      setDbHost(dbHostEntry.host);
                      setDbPort(String(dbHostEntry.port));
                      setDbUsername(dbHostEntry.username);
                      setDbPassword(dbHostEntry.password);
                    }}
                  >
                    Edit
                  </button>
                  <button
                    className="rounded-md border border-rose-200 px-2 py-1 text-rose-600 transition-all duration-300 hover:border-rose-400 disabled:opacity-60 dark:border-rose-500/30 dark:text-rose-400"
                    onClick={() => deleteHostMutation.mutate(dbHostEntry.id)}
                    disabled={deleteHostMutation.isPending}
                  >
                    Delete
                  </button>
                </div>
              </div>
              {dbHostId === dbHostEntry.id ? (
                <div className="mt-4 space-y-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-4 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-300">
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <label className="block">
                      Name
                      <input
                        className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
                        value={dbName}
                        onChange={(event) => setDbName(event.target.value)}
                      />
                    </label>
                    <label className="block">
                      Host
                      <input
                        className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
                        value={dbHost}
                        onChange={(event) => setDbHost(event.target.value)}
                      />
                    </label>
                    <label className="block">
                      Port
                      <input
                        className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
                        value={dbPort}
                        onChange={(event) => setDbPort(event.target.value)}
                      />
                    </label>
                    <label className="block">
                      Username
                      <input
                        className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
                        value={dbUsername}
                        onChange={(event) => setDbUsername(event.target.value)}
                      />
                    </label>
                    <label className="block sm:col-span-2">
                      Password
                      <input
                        type="password"
                        className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
                        value={dbPassword}
                        onChange={(event) => setDbPassword(event.target.value)}
                      />
                    </label>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      className="rounded-md bg-primary-600 px-3 py-1 text-xs font-semibold text-white shadow-lg shadow-primary-500/20 transition-all duration-300 hover:bg-primary-500 disabled:opacity-60"
                      onClick={() => updateHostMutation.mutate({ hostId: dbHostEntry.id })}
                      disabled={updateHostMutation.isPending}
                    >
                      Save
                    </button>
                    <button
                      className="rounded-md border border-slate-200 px-3 py-1 text-xs text-slate-600 transition-all duration-300 hover:border-primary-500 hover:text-slate-900 dark:border-slate-800 dark:text-slate-300 dark:hover:border-primary-500/30"
                      onClick={() => setDbHostId(null)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default DatabasePage;

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import EmptyState from '../../components/shared/EmptyState';
import { adminApi } from '../../services/api/admin';
import { useNodes } from '../../hooks/useNodes';
import { notifyError, notifySuccess } from '../../utils/notify';


const parseReserved = (value: string) =>
  value
    .split(/[\s,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);

function NetworkPage() {
  const [nodeId, setNodeId] = useState('');
  const [networkName, setNetworkName] = useState('mc-lan');
  const [cidr, setCidr] = useState('');
  const [gateway, setGateway] = useState('');
  const [startIp, setStartIp] = useState('');
  const [endIp, setEndIp] = useState('');
  const [reserved, setReserved] = useState('');
  const [autoFillIp, setAutoFillIp] = useState('');
  const queryClient = useQueryClient();
  const { data: nodes = [] } = useNodes();
  const { data: pools = [], isLoading } = useQuery({
    queryKey: ['ip-pools'],
    queryFn: adminApi.listIpPools,
  });
  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === nodeId),
    [nodes, nodeId],
  );
  const poolStats = useMemo(
    () =>
      pools.reduce(
        (acc, pool) => {
          acc.available += pool.availableCount;
          acc.used += pool.usedCount;
          acc.reserved += pool.reservedCount;
          acc.total += pool.total;
          return acc;
        },
        { available: 0, used: 0, reserved: 0, total: 0 },
      ),
    [pools],
  );

  const canSubmit = useMemo(
    () => nodeId && networkName && cidr,
    [nodeId, networkName, cidr],
  );

  const createMutation = useMutation({
    mutationFn: () =>
      adminApi.createIpPool({
        nodeId,
        networkName,
        cidr,
        gateway: gateway || undefined,
        startIp: startIp || undefined,
        endIp: endIp || undefined,
        reserved: reserved ? parseReserved(reserved) : undefined,
      }),
    onSuccess: () => {
      notifySuccess('IP pool created');
      queryClient.invalidateQueries({ queryKey: ['ip-pools'] });
      setCidr('');
      setGateway('');
      setStartIp('');
      setEndIp('');
      setReserved('');
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || 'Failed to create IP pool';
      notifyError(message);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (poolId: string) => adminApi.deleteIpPool(poolId),
    onSuccess: () => {
      notifySuccess('IP pool removed');
      queryClient.invalidateQueries({ queryKey: ['ip-pools'] });
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || 'Failed to remove IP pool';
      notifyError(message);
    },
  });

  const handleAutoFill = () => {
    if (!autoFillIp) return;
    const parts = autoFillIp.trim().split('.');
    if (parts.length < 3) return;
    const base = `${parts[0]}.${parts[1]}.${parts[2]}`;
    setCidr(`${base}.0/24`);
    setGateway(`${base}.1`);
    setStartIp(`${base}.10`);
    setEndIp(`${base}.250`);
  };

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-surface-light transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:shadow-surface-dark dark:hover:border-primary-500/30">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Network</h1>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Manage IP pools for macvlan network allocations.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs text-slate-600 dark:text-slate-400">
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 dark:border-slate-800 dark:bg-slate-950/60">
              {pools.length} pools
            </span>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 dark:border-slate-800 dark:bg-slate-950/60">
              {nodes.length} nodes
            </span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-surface-light transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:shadow-surface-dark dark:hover:border-primary-500/30">
          <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Total IPs
          </div>
          <div className="mt-2 text-2xl font-semibold text-slate-900 dark:text-white">
            {poolStats.total}
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">Across all pools</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-surface-light transition-all duration-300 hover:border-emerald-500 dark:border-slate-800 dark:bg-slate-900 dark:shadow-surface-dark dark:hover:border-emerald-500/40">
          <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Available
          </div>
          <div className="mt-2 text-2xl font-semibold text-slate-900 dark:text-white">
            {poolStats.available}
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">Open for allocation</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-surface-light transition-all duration-300 hover:border-indigo-500 dark:border-slate-800 dark:bg-slate-900 dark:shadow-surface-dark dark:hover:border-indigo-500/40">
          <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Used
          </div>
          <div className="mt-2 text-2xl font-semibold text-slate-900 dark:text-white">
            {poolStats.used}
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">Assigned to servers</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-surface-light transition-all duration-300 hover:border-amber-500 dark:border-slate-800 dark:bg-slate-900 dark:shadow-surface-dark dark:hover:border-amber-500/40">
          <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Reserved
          </div>
          <div className="mt-2 text-2xl font-semibold text-slate-900 dark:text-white">
            {poolStats.reserved}
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">Held for static use</div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white px-6 py-5 shadow-surface-light dark:shadow-surface-dark transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-primary-500/30">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Create IP Pool</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Allocate static macvlan IPs per node. Pools map to network names (e.g. mc-lan).
            </p>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[2fr_1fr]">
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4 dark:border-slate-800 dark:bg-slate-900/60">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <label className="block text-xs text-slate-500 dark:text-slate-300">
                Node
                <select
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
                  value={nodeId}
                  onChange={(event) => setNodeId(event.target.value)}
                >
                  <option value="">Select node</option>
                  {nodes.map((node) => (
                    <option key={node.id} value={node.id}>
                      {node.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs text-slate-500 dark:text-slate-300">
                Network name
                <input
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
                  value={networkName}
                  onChange={(event) => setNetworkName(event.target.value)}
                  placeholder="mc-lan"
                />
              </label>
              <label className="block text-xs text-slate-500 dark:text-slate-300">
                CIDR
                <input
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
                  value={cidr}
                  onChange={(event) => setCidr(event.target.value)}
                  placeholder="192.168.50.0/24"
                />
              </label>
              <label className="block text-xs text-slate-500 dark:text-slate-300">
                Gateway
                <input
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
                  value={gateway}
                  onChange={(event) => setGateway(event.target.value)}
                  placeholder="192.168.50.1"
                />
              </label>
              <label className="block text-xs text-slate-500 dark:text-slate-300">
                Start IP (optional)
                <input
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
                  value={startIp}
                  onChange={(event) => setStartIp(event.target.value)}
                  placeholder="192.168.50.10"
                />
              </label>
              <label className="block text-xs text-slate-500 dark:text-slate-300">
                End IP (optional)
                <input
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
                  value={endIp}
                  onChange={(event) => setEndIp(event.target.value)}
                  placeholder="192.168.50.200"
                />
              </label>
              <label className="block text-xs text-slate-500 dark:text-slate-300 md:col-span-3">
                Reserved IPs (comma or space separated)
                <textarea
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
                  value={reserved}
                  onChange={(event) => setReserved(event.target.value)}
                  rows={2}
                  placeholder="192.168.50.20, 192.168.50.21"
                />
              </label>
            </div>
            <div className="mt-4 flex justify-end">
              <button
                className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-primary-500/20 transition-all duration-300 hover:bg-primary-500 disabled:opacity-60"
                disabled={!canSubmit || createMutation.isPending}
                onClick={() => createMutation.mutate()}
              >
                Create pool
              </button>
            </div>
          </div>
          <div className="space-y-3">
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-600 transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-primary-500/30">
              <div className="font-semibold text-slate-900 dark:text-slate-100">
                How this maps to allocations
              </div>
              <p className="mt-1 text-slate-500 dark:text-slate-400">
                Catalyst uses IP pools for macvlan networking. Each server picks a primary IP from the pool,
                while port bindings are configured on the server settings page.
              </p>
            </div>
            <div className="rounded-xl border border-dashed border-slate-200 bg-white px-4 py-3 text-xs text-slate-600 transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-primary-500/30">
              <div className="font-semibold text-slate-900 dark:text-slate-100">Quick setup</div>
              <div className="mt-1 text-slate-500 dark:text-slate-400">
                Paste a host IP to autofill a /24 pool. You can edit any field afterwards.
              </div>
              <div className="mt-3 flex flex-wrap items-end gap-3">
                <label className="block text-xs text-slate-500 dark:text-slate-300">
                  Host IP
                  <input
                    className="mt-1 w-48 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
                    value={autoFillIp}
                    onChange={(event) => setAutoFillIp(event.target.value)}
                    placeholder={selectedNode?.publicAddress || '192.168.1.78'}
                  />
                </label>
                <button
                  type="button"
                  className="rounded-md border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600 transition-all duration-300 hover:border-primary-500 hover:text-slate-900 dark:border-slate-800 dark:text-slate-300 dark:hover:border-primary-500/30"
                  onClick={handleAutoFill}
                  disabled={!autoFillIp.trim()}
                >
                  Autofill /24
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">IP Address Pools</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Allocate static macvlan IPs per node. Pools map to network names (e.g. mc-lan).
          </p>
        </div>
        <div className="text-xs text-slate-500 dark:text-slate-400">
          {pools.length} pools · {poolStats.total} total IPs
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {isLoading ? (
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-6 text-slate-600 shadow-surface-light dark:shadow-surface-dark transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-primary-500/30">
            Loading IP pools...
          </div>
        ) : pools.length === 0 ? (
          <EmptyState
            title="No IP pools yet"
            description="Create a pool to allocate static macvlan IPs."
          />
        ) : (
          pools.map((pool) => (
            <div
              key={pool.id}
              className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-surface-light dark:shadow-surface-dark transition-all duration-300 hover:-translate-y-1 hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-primary-500/30"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {pool.nodeName} · {pool.networkName}
                  </div>
                  <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    {pool.cidr}
                  </div>
                  <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                    Range: {pool.rangeStart} → {pool.rangeEnd}
                  </div>
                </div>
                <button
                  className="rounded-full border border-rose-200 px-3 py-1 text-xs font-semibold text-rose-600 transition-all duration-300 hover:border-rose-400 dark:border-rose-500/30 dark:text-rose-400"
                  onClick={() => deleteMutation.mutate(pool.id)}
                  disabled={deleteMutation.isPending}
                >
                  Delete
                </button>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2 text-xs text-slate-600 dark:text-slate-300">
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 transition-all duration-300 group-hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:group-hover:border-primary-500/30">
                  <div className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-500">
                    Available
                  </div>
                  <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {pool.availableCount}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 transition-all duration-300 group-hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:group-hover:border-primary-500/30">
                  <div className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-500">
                    Used
                  </div>
                  <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {pool.usedCount}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 transition-all duration-300 group-hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:group-hover:border-primary-500/30">
                  <div className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-500">
                    Reserved
                  </div>
                  <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {pool.reservedCount}
                  </div>
                </div>
              </div>
              <div className="mt-3 text-xs text-slate-500 dark:text-slate-400">
                Total: {pool.total} · Gateway: {pool.gateway ?? 'n/a'}
              </div>
              {pool.allocations && pool.allocations.length > 0 && (
                <div className="mt-4 border-t border-slate-200 pt-3 dark:border-slate-800">
                  <div className="text-xs font-semibold text-slate-900 dark:text-white mb-2">
                    Assigned IPs ({pool.allocations.length})
                  </div>
                  <div className="space-y-1 max-h-32 overflow-y-auto">
                    {pool.allocations.map((alloc) => (
                      <div key={alloc.id} className="flex items-center justify-between text-xs">
                        <span className="font-mono text-slate-600 dark:text-slate-400">{alloc.ip}</span>
                        <span className="text-slate-500 dark:text-slate-500">→</span>
                        <span className="text-slate-900 dark:text-slate-100">{alloc.serverName}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default NetworkPage;

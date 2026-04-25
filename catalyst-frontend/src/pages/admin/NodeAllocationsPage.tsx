import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { qk } from '@/lib/queryKeys';
import { queryClient } from '@/lib/queryClient';
import { useParams, Link } from 'react-router-dom';
import apiClient from '../../services/api/client';
import { notifyError, notifySuccess } from '../../utils/notify';
import { useNodes } from '../../hooks/useNodes';
import { adminApi } from '../../services/api/admin';
import { ModalPortal } from '@/components/ui/modal-portal';

interface NodeAllocation {
  id: string;
  nodeId: string;
  serverId: string | null;
  ip: string;
  port: number;
  alias: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

interface IpPool {
  id: string;
  nodeId: string;
  nodeName: string;
  networkName: string;
  cidr: string;
  gateway: string | null;
  rangeStart: string;
  rangeEnd: string;
  total: number;
  availableCount: number;
  usedCount: number;
  reservedCount: number;
  allocations?: Array<{
    id: string;
    ip: string;
    serverId: string | null;
    serverName?: string;
    serverStatus?: string;
    createdAt: string;
  }>;
}

const parseReserved = (value: string) =>
  value
    .split(/[\s,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);

function NodeAllocationsPage() {
  const { nodeId } = useParams<{ nodeId: string }>();

  // Tab state
  const [activeTab, setActiveTab] = useState<'ports' | 'ips'>('ports');

  // Port allocations state
  const [search, setSearch] = useState('');
  const [showCreatePortModal, setShowCreatePortModal] = useState(false);
  const [ipInput, setIpInput] = useState('');
  const [portsInput, setPortsInput] = useState('');
  const [aliasInput, setAliasInput] = useState('');

  // IP pool state
  const [showCreatePoolModal, setShowCreatePoolModal] = useState(false);
  const [networkName, setNetworkName] = useState('mc-lan');
  const [cidr, setCidr] = useState('');
  const [gateway, setGateway] = useState('');
  const [startIp, setStartIp] = useState('');
  const [endIp, setEndIp] = useState('');
  const [reserved, setReserved] = useState('');
  const [autoFillIp, setAutoFillIp] = useState('');

  const { data: nodes = [] } = useNodes();
  const node = nodes.find((n) => n.id === nodeId);

  // Fetch port allocations (NodeAllocation)
  const { data: allocations = [], isLoading: allocationsLoading } = useQuery<NodeAllocation[]>({
    queryKey: ['node-allocations', nodeId],
    queryFn: async () => {
      const response = await apiClient.get(`/api/nodes/${nodeId}/allocations`);
      return response.data ?? [];
    },
    enabled: !!nodeId,
    refetchInterval: 10000,
  });

  // Fetch IP pools (IpAllocation via pools)
  const { data: allPools = [], isLoading: poolsLoading } = useQuery({
    queryKey: qk.adminIpPools(nodeId!),
    queryFn: adminApi.listIpPools,
    refetchInterval: 15000,
  });

  const nodePools = useMemo(() => (allPools as IpPool[]).filter((p: IpPool) => p.nodeId === nodeId), [allPools, nodeId]);

  // Port allocation mutations
  const createPortMutation = useMutation({
    mutationFn: async () => {
      return apiClient.post(`/api/nodes/${nodeId}/allocations`, {
        ip: ipInput.trim(),
        ports: portsInput.trim(),
        alias: aliasInput.trim() || undefined,
      });
    },
    onSuccess: (response) => {
      const created = response.data?.data?.created || 0;
      notifySuccess(`Created ${created} port allocation${created !== 1 ? 's' : ''}`);
      queryClient.invalidateQueries({ queryKey: qk.adminNodeAllocations(nodeId) });
      setShowCreatePortModal(false);
      setIpInput('');
      setPortsInput('');
      setAliasInput('');
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || 'Failed to create port allocations';
      notifyError(message);
    },
  });

  const deletePortMutation = useMutation({
    mutationFn: async (allocationId: string) => {
      return apiClient.delete(`/api/nodes/${nodeId}/allocations/${allocationId}`);
    },
    onSuccess: () => {
      notifySuccess('Port allocation deleted');
      queryClient.invalidateQueries({ queryKey: qk.adminNodeAllocations(nodeId) });
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || 'Failed to delete port allocation';
      notifyError(message);
    },
  });

  // IP pool mutations
  const createPoolMutation = useMutation({
    mutationFn: () =>
      adminApi.createIpPool({
        nodeId: nodeId!,
        networkName,
        cidr,
        gateway: gateway || undefined,
        startIp: startIp || undefined,
        endIp: endIp || undefined,
        reserved: reserved ? parseReserved(reserved) : undefined,
      }),
    onSuccess: () => {
      notifySuccess('IP pool created');
      queryClient.invalidateQueries({ queryKey: qk.adminIpPools(nodeId) });
      setShowCreatePoolModal(false);
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

  const deletePoolMutation = useMutation({
    mutationFn: (poolId: string) => adminApi.deleteIpPool(poolId),
    onSuccess: () => {
      notifySuccess('IP pool deleted');
      queryClient.invalidateQueries({ queryKey: qk.adminIpPools(nodeId) });
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || 'Failed to delete IP pool';
      notifyError(message);
    },
  });

  // Filtered port allocations
  const filteredAllocations = useMemo(() => {
    if (!search.trim()) return allocations;
    const query = search.toLowerCase();
    return allocations.filter(
      (a) =>
        a.ip.includes(query) ||
        a.port.toString().includes(query) ||
        a.alias?.toLowerCase().includes(query) ||
        a.notes?.toLowerCase().includes(query),
    );
  }, [allocations, search]);

  // Port allocation stats
  const portStats = useMemo(() => {
    const assigned = allocations.filter((a) => a.serverId).length;
    const available = allocations.length - assigned;
    const uniqueIps = new Set(allocations.map((a) => a.ip)).size;
    return { total: allocations.length, assigned, available, uniqueIps };
  }, [allocations]);

  // IP pool stats
  const ipPoolStats = useMemo(() => {
    const totals = nodePools.reduce(
      (acc: { available: number; used: number; total: number; reserved: number }, pool: IpPool) => {
        acc.available += pool.availableCount;
        acc.used += pool.usedCount;
        acc.reserved += pool.reservedCount;
        acc.total += pool.total;
        return acc;
      },
      { available: 0, used: 0, reserved: 0, total: 0 },
    );
    return { ...totals, pools: nodePools.length };
  }, [nodePools]);

  const handleQuickFillPorts = () => {
    if (node?.publicAddress) {
      setIpInput(node.publicAddress);
      setPortsInput('25565-25664');
    }
  };

  const handleAutoFillPool = () => {
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
      {/* Breadcrumb */}
      <div className="flex items-center gap-3 text-sm text-muted-foreground dark:text-muted-foreground">
        <Link to="/admin/nodes" className="hover:text-primary-600 dark:hover:text-primary-400">
          Nodes
        </Link>
        <span>/</span>
        <span className="text-foreground dark:text-white">{node?.name || 'Loading...'}</span>
        <span>/</span>
        <span className="text-foreground dark:text-white">Network Allocations</span>
      </div>

      {/* Header */}
      <div className="rounded-2xl border border-border bg-white p-6 shadow-surface-light transition-all duration-300 hover:border-primary-500 dark:border-border dark:bg-surface-1 dark:shadow-surface-dark dark:hover:border-primary/30">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-foreground dark:text-white">
              Network Allocations
            </h1>
            <p className="text-sm text-muted-foreground dark:text-muted-foreground">
              Manage port bindings and IP pools for <span className="font-semibold">{node?.name}</span>
            </p>
          </div>
        </div>
        
        {/* Help text */}
        <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900 dark:border-blue-900/30 dark:bg-blue-950/20 dark:text-blue-300">
          <strong>💡 Two allocation types:</strong>
          <ul className="ml-4 mt-1 list-disc space-y-1">
            <li><strong>Port Allocations</strong> - Track IP:Port combinations for proxy/NAT setups (like Pterodactyl)</li>
            <li><strong>IP Pools</strong> - Automatic MACVLAN networking with dedicated IPs per server (advanced)</li>
          </ul>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-border dark:border-border">
        <button
          onClick={() => setActiveTab('ports')}
          className={`px-4 py-2 text-sm font-semibold transition-all ${
            activeTab === 'ports'
              ? 'border-b-2 border-primary-600 text-primary-600 dark:border-primary-400 dark:text-primary-400'
              : 'text-muted-foreground hover:text-foreground dark:text-muted-foreground dark:hover:text-zinc-100'
          }`}
        >
          Port Allocations ({portStats.total})
        </button>
        <button
          onClick={() => setActiveTab('ips')}
          className={`px-4 py-2 text-sm font-semibold transition-all ${
            activeTab === 'ips'
              ? 'border-b-2 border-primary-600 text-primary-600 dark:border-primary-400 dark:text-primary-400'
              : 'text-muted-foreground hover:text-foreground dark:text-muted-foreground dark:hover:text-zinc-100'
          }`}
        >
          IP Pools ({ipPoolStats.pools})
        </button>
      </div>

      {/* Port Allocations Tab */}
      {activeTab === 'ports' && (
        <>
          {/* Stats */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
            <div className="rounded-2xl border border-border bg-white px-5 py-4 shadow-surface-light transition-all duration-300 hover:border-primary-500 dark:border-border dark:bg-surface-1 dark:shadow-surface-dark dark:hover:border-primary/30">
              <div className="text-xs uppercase tracking-wide text-muted-foreground dark:text-muted-foreground">
                Total Ports
              </div>
              <div className="mt-2 text-2xl font-semibold text-foreground dark:text-white">
                {portStats.total}
              </div>
            </div>
            <div className="rounded-2xl border border-border bg-white px-5 py-4 shadow-surface-light transition-all duration-300 hover:border-emerald-500 dark:border-border dark:bg-surface-1 dark:shadow-surface-dark dark:hover:border-emerald-500/40">
              <div className="text-xs uppercase tracking-wide text-muted-foreground dark:text-muted-foreground">
                Available
              </div>
              <div className="mt-2 text-2xl font-semibold text-foreground dark:text-white">
                {portStats.available}
              </div>
            </div>
            <div className="rounded-2xl border border-border bg-white px-5 py-4 shadow-surface-light transition-all duration-300 hover:border-indigo-500 dark:border-border dark:bg-surface-1 dark:shadow-surface-dark dark:hover:border-indigo-500/40">
              <div className="text-xs uppercase tracking-wide text-muted-foreground dark:text-muted-foreground">
                Assigned
              </div>
              <div className="mt-2 text-2xl font-semibold text-foreground dark:text-white">
                {portStats.assigned}
              </div>
            </div>
            <div className="rounded-2xl border border-border bg-white px-5 py-4 shadow-surface-light transition-all duration-300 hover:border-amber-500 dark:border-border dark:bg-surface-1 dark:shadow-surface-dark dark:hover:border-amber-500/40">
              <div className="text-xs uppercase tracking-wide text-muted-foreground dark:text-muted-foreground">
                Unique IPs
              </div>
              <div className="mt-2 text-2xl font-semibold text-foreground dark:text-white">
                {portStats.uniqueIps}
              </div>
            </div>
          </div>

          {/* Search and Create */}
          <div className="flex items-center justify-between gap-3">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by IP, port, alias..."
              className="flex-1 rounded-lg border border-border bg-white px-3 py-2 text-sm text-foreground transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-border dark:bg-surface-1 dark:text-zinc-200 dark:focus:border-primary-400 dark:hover:border-primary/30"
            />
            <button
              onClick={() => setShowCreatePortModal(true)}
              className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-primary-500/20 transition-all duration-300 hover:bg-primary-500"
            >
              Create Allocations
            </button>
          </div>

          {/* Port Allocations Table */}
          {allocationsLoading ? (
            <div className="rounded-xl border border-border bg-white px-4 py-6 text-muted-foreground dark:border-border dark:bg-surface-1 dark:text-zinc-300">
              Loading port allocations...
            </div>
          ) : filteredAllocations.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-surface-2 px-6 py-12 text-center dark:border-border dark:bg-surface-1/40">
              <p className="text-muted-foreground dark:text-muted-foreground">
                {search.trim() ? 'No port allocations match your search' : 'No port allocations yet'}
              </p>
              {!search.trim() && (
                <button
                  onClick={() => setShowCreatePortModal(true)}
                  className="mt-3 text-sm text-primary-600 hover:text-primary-500 dark:text-primary-400"
                >
                  Create your first port allocations
                </button>
              )}
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-border bg-white shadow-surface-light dark:border-border dark:bg-surface-1 dark:shadow-surface-dark">
              <table className="w-full text-sm">
                <thead className="border-b border-border bg-surface-2 dark:border-border dark:bg-zinc-950/60">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold text-foreground dark:text-white">
                      IP Address
                    </th>
                    <th className="px-4 py-3 text-left font-semibold text-foreground dark:text-white">
                      Port
                    </th>
                    <th className="px-4 py-3 text-left font-semibold text-foreground dark:text-white">
                      Alias
                    </th>
                    <th className="px-4 py-3 text-left font-semibold text-foreground dark:text-white">
                      Status
                    </th>
                    <th className="px-4 py-3 text-right font-semibold text-foreground dark:text-white">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {filteredAllocations.map((allocation) => (
                    <tr
                      key={allocation.id}
                      className="transition-colors hover:bg-surface-2 dark:hover:bg-zinc-950/40"
                    >
                      <td className="px-4 py-3 font-mono text-foreground dark:text-white">
                        {allocation.ip}
                      </td>
                      <td className="px-4 py-3 font-mono text-foreground dark:text-white">
                        {allocation.port}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground dark:text-muted-foreground">
                        {allocation.alias || '-'}
                      </td>
                      <td className="px-4 py-3">
                        {allocation.serverId ? (
                          <span className="inline-flex items-center rounded-full bg-indigo-100 px-2.5 py-0.5 text-xs font-semibold text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300">
                            Assigned
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
                            Available
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {!allocation.serverId && (
                          <button
                            onClick={() => deletePortMutation.mutate(allocation.id)}
                            disabled={deletePortMutation.isPending}
                            className="text-xs text-rose-600 hover:text-rose-500 dark:text-rose-400 dark:hover:text-rose-300"
                          >
                            Delete
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* IP Pools Tab */}
      {activeTab === 'ips' && (
        <>
          {/* Stats */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
            <div className="rounded-2xl border border-border bg-white px-5 py-4 shadow-surface-light transition-all duration-300 hover:border-primary-500 dark:border-border dark:bg-surface-1 dark:shadow-surface-dark dark:hover:border-primary/30">
              <div className="text-xs uppercase tracking-wide text-muted-foreground dark:text-muted-foreground">
                Total IPs
              </div>
              <div className="mt-2 text-2xl font-semibold text-foreground dark:text-white">
                {ipPoolStats.total}
              </div>
            </div>
            <div className="rounded-2xl border border-border bg-white px-5 py-4 shadow-surface-light transition-all duration-300 hover:border-emerald-500 dark:border-border dark:bg-surface-1 dark:shadow-surface-dark dark:hover:border-emerald-500/40">
              <div className="text-xs uppercase tracking-wide text-muted-foreground dark:text-muted-foreground">
                Available
              </div>
              <div className="mt-2 text-2xl font-semibold text-foreground dark:text-white">
                {ipPoolStats.available}
              </div>
            </div>
            <div className="rounded-2xl border border-border bg-white px-5 py-4 shadow-surface-light transition-all duration-300 hover:border-indigo-500 dark:border-border dark:bg-surface-1 dark:shadow-surface-dark dark:hover:border-indigo-500/40">
              <div className="text-xs uppercase tracking-wide text-muted-foreground dark:text-muted-foreground">
                Used
              </div>
              <div className="mt-2 text-2xl font-semibold text-foreground dark:text-white">
                {ipPoolStats.used}
              </div>
            </div>
            <div className="rounded-2xl border border-border bg-white px-5 py-4 shadow-surface-light transition-all duration-300 hover:border-amber-500 dark:border-border dark:bg-surface-1 dark:shadow-surface-dark dark:hover:border-amber-500/40">
              <div className="text-xs uppercase tracking-wide text-muted-foreground dark:text-muted-foreground">
                Reserved
              </div>
              <div className="mt-2 text-2xl font-semibold text-foreground dark:text-white">
                {ipPoolStats.reserved}
              </div>
            </div>
          </div>

          {/* Create Pool Button */}
          <div className="flex justify-end">
            <button
              onClick={() => setShowCreatePoolModal(true)}
              className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-primary-500/20 transition-all duration-300 hover:bg-primary-500"
            >
              Create IP Pool
            </button>
          </div>

          {/* IP Pools List */}
          {poolsLoading ? (
            <div className="rounded-xl border border-border bg-white px-4 py-6 text-muted-foreground dark:border-border dark:bg-surface-1 dark:text-zinc-300">
              Loading IP pools...
            </div>
          ) : nodePools.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-surface-2 px-6 py-12 text-center dark:border-border dark:bg-surface-1/40">
              <p className="text-muted-foreground dark:text-muted-foreground">No IP pools for this node yet</p>
              <button
                onClick={() => setShowCreatePoolModal(true)}
                className="mt-3 text-sm text-primary-600 hover:text-primary-500 dark:text-primary-400"
              >
                Create your first IP pool
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {nodePools.map((pool: IpPool) => (
                <div
                  key={pool.id}
                  className="rounded-2xl border border-border bg-white px-5 py-4 shadow-surface-light transition-all duration-300 hover:-translate-y-1 hover:border-primary-500 dark:border-border dark:bg-surface-1 dark:shadow-surface-dark dark:hover:border-primary/30"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-foreground dark:text-zinc-100">
                        {pool.networkName}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground dark:text-muted-foreground">
                        {pool.cidr}
                      </div>
                      <div className="mt-2 text-xs text-muted-foreground dark:text-muted-foreground">
                        Range: {pool.rangeStart} → {pool.rangeEnd}
                      </div>
                    </div>
                    <button
                      className="rounded-full border border-rose-200 px-3 py-1 text-xs font-semibold text-rose-600 transition-all duration-300 hover:border-rose-400 dark:border-rose-500/30 dark:text-rose-400"
                      onClick={() => deletePoolMutation.mutate(pool.id)}
                      disabled={deletePoolMutation.isPending}
                    >
                      Delete
                    </button>
                  </div>
                  <div className="mt-4 grid grid-cols-3 gap-2 text-xs text-muted-foreground dark:text-zinc-300">
                    <div className="rounded-xl border border-border bg-surface-2 px-3 py-2 dark:border-border dark:bg-surface-1">
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground dark:text-muted-foreground">
                        Available
                      </div>
                      <div className="text-sm font-semibold text-foreground dark:text-zinc-100">
                        {pool.availableCount}
                      </div>
                    </div>
                    <div className="rounded-xl border border-border bg-surface-2 px-3 py-2 dark:border-border dark:bg-surface-1">
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground dark:text-muted-foreground">
                        Used
                      </div>
                      <div className="text-sm font-semibold text-foreground dark:text-zinc-100">
                        {pool.usedCount}
                      </div>
                    </div>
                    <div className="rounded-xl border border-border bg-surface-2 px-3 py-2 dark:border-border dark:bg-surface-1">
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground dark:text-muted-foreground">
                        Reserved
                      </div>
                      <div className="text-sm font-semibold text-foreground dark:text-zinc-100">
                        {pool.reservedCount}
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 text-xs text-muted-foreground dark:text-muted-foreground">
                    Total: {pool.total} · Gateway: {pool.gateway ?? 'n/a'}
                  </div>
                  {pool.allocations && pool.allocations.length > 0 && (
                    <div className="mt-4 border-t border-border pt-3 dark:border-border">
                      <div className="mb-2 text-xs font-semibold text-foreground dark:text-white">
                        Assigned IPs ({pool.allocations.length})
                      </div>
                      <div className="max-h-32 space-y-1 overflow-y-auto">
                        {pool.allocations?.map((alloc: any) => (
                          <div key={alloc.id} className="flex items-center justify-between text-xs">
                            <span className="font-mono text-muted-foreground dark:text-muted-foreground">
                              {alloc.ip}
                            </span>
                            <span className="text-muted-foreground dark:text-muted-foreground">→</span>
                            <span className="text-foreground dark:text-zinc-100">
                              {alloc.serverName}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Create Port Allocations Modal */}
      {showCreatePortModal && (
        <ModalPortal>
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-2xl rounded-2xl border border-border bg-white p-6 shadow-xl dark:border-border dark:bg-surface-1">
            <h2 className="text-xl font-semibold text-foreground dark:text-white">
              Create Port Allocations
            </h2>
            <p className="mt-1 text-sm text-muted-foreground dark:text-muted-foreground">
              Bulk create IP:Port allocations for this node (Pterodactyl-style)
            </p>

            <div className="mt-6 space-y-4">
              <div className="rounded-xl border border-border bg-surface-2 px-4 py-3 dark:border-border dark:bg-surface-1/60">
                <p className="text-xs text-muted-foreground dark:text-muted-foreground">
                  <strong>IP format:</strong> Single IP (192.168.1.100), multiple IPs
                  (192.168.1.100, 192.168.1.101), or CIDR (192.168.1.0/24)
                </p>
                <p className="mt-1 text-xs text-muted-foreground dark:text-muted-foreground">
                  <strong>Port format:</strong> Single port (25565), range (25565-25664), or
                  multiple (25565, 25566, 25567)
                </p>
              </div>

              <label className="block text-sm text-foreground dark:text-zinc-300">
                IP Address(es)
                <input
                  type="text"
                  value={ipInput}
                  onChange={(e) => setIpInput(e.target.value)}
                  placeholder="192.168.1.100 or 192.168.1.0/24"
                  className="mt-1 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-foreground transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-border dark:bg-surface-1 dark:text-zinc-200 dark:focus:border-primary-400 dark:hover:border-primary/30"
                />
              </label>

              <label className="block text-sm text-foreground dark:text-zinc-300">
                Port(s)
                <input
                  type="text"
                  value={portsInput}
                  onChange={(e) => setPortsInput(e.target.value)}
                  placeholder="25565-25664 or 25565, 25566"
                  className="mt-1 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-foreground transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-border dark:bg-surface-1 dark:text-zinc-200 dark:focus:border-primary-400 dark:hover:border-primary/30"
                />
              </label>

              <label className="block text-sm text-foreground dark:text-zinc-300">
                Alias (optional)
                <input
                  type="text"
                  value={aliasInput}
                  onChange={(e) => setAliasInput(e.target.value)}
                  placeholder="e.g., Main network"
                  className="mt-1 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-foreground transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-border dark:bg-surface-1 dark:text-zinc-200 dark:focus:border-primary-400 dark:hover:border-primary/30"
                />
              </label>

              <button
                onClick={handleQuickFillPorts}
                className="text-sm text-primary-600 hover:text-primary-500 dark:text-primary-400"
              >
                Quick fill: Use node IP + ports 25565-25664
              </button>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setShowCreatePortModal(false)}
                className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-muted-foreground transition-all duration-300 hover:border-border dark:border-border dark:text-zinc-300 dark:hover:border-zinc-600"
              >
                Cancel
              </button>
              <button
                onClick={() => createPortMutation.mutate()}
                disabled={!ipInput.trim() || !portsInput.trim() || createPortMutation.isPending}
                className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-primary-500/20 transition-all duration-300 hover:bg-primary-500 disabled:opacity-60"
              >
                {createPortMutation.isPending ? 'Creating...' : 'Create Allocations'}
              </button>
            </div>
          </div>
        </div>
        </ModalPortal>
      )}

      {/* Create IP Pool Modal */}
      {showCreatePoolModal && (
        <ModalPortal>
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-2xl rounded-2xl border border-border bg-white p-6 shadow-xl dark:border-border dark:bg-surface-1">
            <h2 className="text-xl font-semibold text-foreground dark:text-white">
              Create IP Pool
            </h2>
            <p className="mt-1 text-sm text-muted-foreground dark:text-muted-foreground">
              Configure MACVLAN network with automatic IPAM (advanced)
            </p>

            <div className="mt-6 space-y-4">
              <div className="rounded-xl border border-border bg-surface-2 px-4 py-3 dark:border-border dark:bg-surface-1/60">
                <p className="text-xs text-muted-foreground dark:text-muted-foreground">
                  IP pools enable servers to get dedicated IP addresses on the network via MACVLAN.
                  Each server automatically receives one IP from the pool.
                </p>
              </div>

              <label className="block text-sm text-foreground dark:text-zinc-300">
                Network Name
                <input
                  type="text"
                  value={networkName}
                  onChange={(e) => setNetworkName(e.target.value)}
                  placeholder="mc-lan"
                  className="mt-1 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-foreground transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-border dark:bg-surface-1 dark:text-zinc-200 dark:focus:border-primary-400 dark:hover:border-primary/30"
                />
              </label>

              <label className="block text-sm text-foreground dark:text-zinc-300">
                CIDR
                <input
                  type="text"
                  value={cidr}
                  onChange={(e) => setCidr(e.target.value)}
                  placeholder="192.168.50.0/24"
                  className="mt-1 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-foreground transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-border dark:bg-surface-1 dark:text-zinc-200 dark:focus:border-primary-400 dark:hover:border-primary/30"
                />
              </label>

              <div className="grid grid-cols-2 gap-4">
                <label className="block text-sm text-foreground dark:text-zinc-300">
                  Gateway
                  <input
                    type="text"
                    value={gateway}
                    onChange={(e) => setGateway(e.target.value)}
                    placeholder="192.168.50.1"
                    className="mt-1 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-foreground transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-border dark:bg-surface-1 dark:text-zinc-200 dark:focus:border-primary-400 dark:hover:border-primary/30"
                  />
                </label>

                <label className="block text-sm text-foreground dark:text-zinc-300">
                  Start IP (optional)
                  <input
                    type="text"
                    value={startIp}
                    onChange={(e) => setStartIp(e.target.value)}
                    placeholder="192.168.50.10"
                    className="mt-1 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-foreground transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-border dark:bg-surface-1 dark:text-zinc-200 dark:focus:border-primary-400 dark:hover:border-primary/30"
                  />
                </label>

                <label className="block text-sm text-foreground dark:text-zinc-300">
                  End IP (optional)
                  <input
                    type="text"
                    value={endIp}
                    onChange={(e) => setEndIp(e.target.value)}
                    placeholder="192.168.50.200"
                    className="mt-1 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-foreground transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-border dark:bg-surface-1 dark:text-zinc-200 dark:focus:border-primary-400 dark:hover:border-primary/30"
                  />
                </label>

                <div className="flex items-end">
                  <button
                    onClick={handleAutoFillPool}
                    disabled={!autoFillIp.trim()}
                    className="w-full rounded-lg border border-border px-3 py-2 text-sm font-semibold text-muted-foreground transition-all duration-300 hover:border-primary-500 disabled:opacity-60 dark:border-border dark:text-zinc-300"
                  >
                    Autofill /24
                  </button>
                </div>
              </div>

              <label className="block text-sm text-foreground dark:text-zinc-300">
                Quick Setup IP
                <input
                  type="text"
                  value={autoFillIp}
                  onChange={(e) => setAutoFillIp(e.target.value)}
                  placeholder={node?.publicAddress || '0.0.0.0'}
                  className="mt-1 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-foreground transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-border dark:bg-surface-1 dark:text-zinc-200 dark:focus:border-primary-400 dark:hover:border-primary/30"
                />
              </label>

              <label className="block text-sm text-foreground dark:text-zinc-300">
                Reserved IPs (optional, comma-separated)
                <textarea
                  value={reserved}
                  onChange={(e) => setReserved(e.target.value)}
                  rows={2}
                  placeholder="192.168.50.20, 192.168.50.21"
                  className="mt-1 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-foreground transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-border dark:bg-surface-1 dark:text-zinc-200 dark:focus:border-primary-400 dark:hover:border-primary/30"
                />
              </label>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setShowCreatePoolModal(false)}
                className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-muted-foreground transition-all duration-300 hover:border-border dark:border-border dark:text-zinc-300 dark:hover:border-zinc-600"
              >
                Cancel
              </button>
              <button
                onClick={() => createPoolMutation.mutate()}
                disabled={!networkName || !cidr || createPoolMutation.isPending}
                className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-primary-500/20 transition-all duration-300 hover:bg-primary-500 disabled:opacity-60"
              >
                {createPoolMutation.isPending ? 'Creating...' : 'Create Pool'}
              </button>
            </div>
          </div>
        </div>
        </ModalPortal>
      )}
    </div>
  );
}

export default NodeAllocationsPage;

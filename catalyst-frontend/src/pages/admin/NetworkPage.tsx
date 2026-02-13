import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import EmptyState from '../../components/shared/EmptyState';
import { adminApi } from '../../services/api/admin';
import { useNodes } from '../../hooks/useNodes';
import { notifyError, notifySuccess } from '../../utils/notify';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Network,
  Search,
  Plus,
  Trash2,
  Server,
  Filter,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  AlertCircle,
} from 'lucide-react';

interface IpAllocation {
  id: string;
  ip: string;
  serverId: string | null;
  serverName?: string;
  serverStatus?: string;
  createdAt: string;
}

interface IpPool {
  id: string;
  nodeId: string;
  nodeName: string;
  networkName: string;
  cidr: string;
  gateway?: string | null;
  startIp?: string | null;
  endIp?: string | null;
  reserved?: string[];
  rangeStart: string;
  rangeEnd: string;
  total: number;
  reservedCount: number;
  usedCount: number;
  availableCount: number;
  createdAt: string;
  updatedAt: string;
  allocations?: IpAllocation[];
}

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

  const [filterNode, setFilterNode] = useState('');
  const [filterCidr, setFilterCidr] = useState('');
  const [searchIp, setSearchIp] = useState('');
  const [expandedPools, setExpandedPools] = useState<Set<string>>(new Set());

  const { data: pools = [], isLoading } = useQuery<IpPool[]>({
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

  const filteredPools = useMemo(() => {
    return pools.filter((pool) => {
      if (filterNode && pool.nodeId !== filterNode) return false;
      if (filterCidr && !pool.cidr.toLowerCase().includes(filterCidr.toLowerCase())) return false;
      return true;
    });
  }, [pools, filterNode, filterCidr]);

  const allAllocations = useMemo(() => {
    const allocs: Array<IpAllocation & { poolId: string; poolCidr: string; nodeName: string }> = [];
    filteredPools.forEach((pool) => {
      pool.allocations?.forEach((alloc) => {
        allocs.push({ ...alloc, poolId: pool.id, poolCidr: pool.cidr, nodeName: pool.nodeName });
      });
    });
    if (searchIp.trim()) {
      const query = searchIp.toLowerCase();
      return allocs.filter(
        (a) =>
          a.ip.toLowerCase().includes(query) ||
          a.serverName?.toLowerCase().includes(query) ||
          a.nodeName.toLowerCase().includes(query),
      );
    }
    return allocs;
  }, [filteredPools, searchIp]);

  const uniqueNodes = useMemo(() => {
    const nodeMap = new Map<string, string>();
    pools.forEach((pool) => nodeMap.set(pool.nodeId, pool.nodeName));
    return Array.from(nodeMap.entries()).map(([id, name]) => ({ id, name }));
  }, [pools]);

  const uniqueCidrs = useMemo(() => {
    return Array.from(new Set(pools.map((p) => p.cidr))).sort();
  }, [pools]);

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

  const togglePoolExpand = (poolId: string) => {
    setExpandedPools((prev) => {
      const next = new Set(prev);
      if (next.has(poolId)) next.delete(poolId);
      else next.add(poolId);
      return next;
    });
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="px-6 py-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Network</h1>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                Manage IP pools for macvlan network allocations
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary" className="text-xs">
                {pools.length} pools
              </Badge>
              <Badge variant="secondary" className="text-xs">
                {nodes.length} nodes
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card className="border-slate-200/80 bg-sky-50/50 dark:bg-sky-900/10">
          <CardContent className="p-4">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Total IPs
            </div>
            <div className="mt-2 text-2xl font-bold text-slate-900 dark:text-white">
              {poolStats.total}
            </div>
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">Across all pools</div>
          </CardContent>
        </Card>
        <Card className="border-emerald-200/80 bg-emerald-50/50 dark:bg-emerald-900/10">
          <CardContent className="p-4">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Available
            </div>
            <div className="mt-2 text-2xl font-bold text-emerald-700 dark:text-emerald-400">
              {poolStats.available}
            </div>
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">Open for allocation</div>
          </CardContent>
        </Card>
        <Card className="border-indigo-200/80 bg-indigo-50/50 dark:bg-indigo-900/10">
          <CardContent className="p-4">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Used
            </div>
            <div className="mt-2 text-2xl font-bold text-indigo-700 dark:text-indigo-400">
              {poolStats.used}
            </div>
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">Assigned to servers</div>
          </CardContent>
        </Card>
        <Card className="border-amber-200/80 bg-amber-50/50 dark:bg-amber-900/10">
          <CardContent className="p-4">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Reserved
            </div>
            <div className="mt-2 text-2xl font-bold text-amber-700 dark:text-amber-400">
              {poolStats.reserved}
            </div>
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">Held for static use</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="border-b border-slate-100 dark:border-slate-800">
          <CardTitle className="text-lg">Create IP Pool</CardTitle>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Allocate static macvlan IPs per node. Pools map to network names (e.g. mc-lan).
          </p>
        </CardHeader>
        <CardContent className="p-6">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div className="space-y-4 lg:col-span-2">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <label className="block">
                  <span className="text-xs font-medium text-slate-700 dark:text-slate-300">Node</span>
                  <select
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-all focus:border-primary-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    value={nodeId}
                    onChange={(e) => setNodeId(e.target.value)}
                  >
                    <option value="">Select node</option>
                    {nodes.map((node) => (
                      <option key={node.id} value={node.id}>
                        {node.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-slate-700 dark:text-slate-300">Network Name</span>
                  <input
                    type="text"
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-all focus:border-primary-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    value={networkName}
                    onChange={(e) => setNetworkName(e.target.value)}
                    placeholder="mc-lan"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-slate-700 dark:text-slate-300">CIDR</span>
                  <input
                    type="text"
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-all focus:border-primary-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    value={cidr}
                    onChange={(e) => setCidr(e.target.value)}
                    placeholder="192.168.50.0/24"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-slate-700 dark:text-slate-300">Gateway</span>
                  <input
                    type="text"
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-all focus:border-primary-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    value={gateway}
                    onChange={(e) => setGateway(e.target.value)}
                    placeholder="192.168.50.1"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-slate-700 dark:text-slate-300">Start IP (optional)</span>
                  <input
                    type="text"
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-all focus:border-primary-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    value={startIp}
                    onChange={(e) => setStartIp(e.target.value)}
                    placeholder="192.168.50.10"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-slate-700 dark:text-slate-300">End IP (optional)</span>
                  <input
                    type="text"
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-all focus:border-primary-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    value={endIp}
                    onChange={(e) => setEndIp(e.target.value)}
                    placeholder="192.168.50.200"
                  />
                </label>
              </div>
              <label className="block">
                <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                  Reserved IPs (comma or space separated)
                </span>
                <textarea
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-all focus:border-primary-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  value={reserved}
                  onChange={(e) => setReserved(e.target.value)}
                  rows={2}
                  placeholder="192.168.50.20, 192.168.50.21"
                />
              </label>
              <div className="flex justify-end">
                <Button onClick={() => createMutation.mutate()} disabled={!canSubmit || createMutation.isPending}>
                  <Plus className="mr-2 h-4 w-4" />
                  Create Pool
                </Button>
              </div>
            </div>
            <div className="space-y-4">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/50">
                <h4 className="text-xs font-semibold text-slate-900 dark:text-white">Quick Setup</h4>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Paste a host IP to autofill a /24 pool configuration.
                </p>
                <div className="mt-3 flex gap-2">
                  <input
                    type="text"
                    className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    value={autoFillIp}
                    onChange={(e) => setAutoFillIp(e.target.value)}
                    placeholder={selectedNode?.publicAddress || '192.168.1.78'}
                  />
                  <Button variant="outline" size="sm" onClick={handleAutoFill} disabled={!autoFillIp.trim()}>
                    Fill
                  </Button>
                </div>
              </div>
              <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 dark:border-blue-900/30 dark:bg-blue-900/20">
                <div className="flex items-start gap-2">
                  <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-blue-600 dark:text-blue-400" />
                  <div className="text-xs text-blue-900 dark:text-blue-200">
                    <strong>How this works:</strong> IP pools assign dedicated MACVLAN addresses to servers.
                    Each server gets one IP from the pool automatically.
                  </div>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg">IP Address Pools</CardTitle>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {filteredPools.length} of {pools.length} pools shown
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-4">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-slate-400" />
              <select
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                value={filterNode}
                onChange={(e) => setFilterNode(e.target.value)}
              >
                <option value="">All Nodes</option>
                {uniqueNodes.map((node) => (
                  <option key={node.id} value={node.id}>
                    {node.name}
                  </option>
                ))}
              </select>
              <select
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                value={filterCidr}
                onChange={(e) => setFilterCidr(e.target.value)}
              >
                <option value="">All CIDRs</option>
                {uniqueCidrs.map((cidr) => (
                  <option key={cidr} value={cidr}>
                    {cidr}
                  </option>
                ))}
              </select>
            </div>
            <div className="relative ml-auto">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                className="w-64 rounded-lg border border-slate-200 bg-white py-1.5 pl-9 pr-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                placeholder="Search IPs or servers..."
                value={searchIp}
                onChange={(e) => setSearchIp(e.target.value)}
              />
            </div>
          </div>

          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-24 w-full" />
              ))}
            </div>
          ) : filteredPools.length === 0 ? (
            <EmptyState
              title={pools.length === 0 ? 'No IP pools yet' : 'No pools match filters'}
              description={
                pools.length === 0
                  ? 'Create a pool to allocate static macvlan IPs.'
                  : 'Try adjusting your filters.'
              }
            />
          ) : (
            <div className="space-y-3">
              {filteredPools.map((pool) => {
                const isExpanded = expandedPools.has(pool.id);
                const utilizationPercent = pool.total > 0 ? Math.round((pool.usedCount / pool.total) * 100) : 0;
                return (
                  <div
                    key={pool.id}
                    className="rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800"
                  >
                    <div
                      className="flex cursor-pointer items-center gap-4 p-4 hover:bg-slate-50 dark:hover:bg-slate-700/50"
                      onClick={() => togglePoolExpand(pool.id)}
                    >
                      <button className="text-slate-400">
                        {isExpanded ? <ChevronDown className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
                      </button>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-slate-900 dark:text-white">{pool.nodeName}</span>
                          <Badge variant="outline" className="text-xs">
                            {pool.networkName}
                          </Badge>
                        </div>
                        <div className="mt-1 flex items-center gap-4 text-xs text-slate-500 dark:text-slate-400">
                          <span className="font-mono">{pool.cidr}</span>
                          <span>Range: {pool.rangeStart} - {pool.rangeEnd}</span>
                          {pool.gateway && <span>Gateway: {pool.gateway}</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="hidden gap-4 sm:flex">
                          <div className="text-center">
                            <div className="text-lg font-bold text-slate-900 dark:text-white">{pool.total}</div>
                            <div className="text-xs text-slate-500 dark:text-slate-400">Total</div>
                          </div>
                          <div className="text-center">
                            <div className="text-lg font-bold text-emerald-600 dark:text-emerald-400">
                              {pool.availableCount}
                            </div>
                            <div className="text-xs text-slate-500 dark:text-slate-400">Free</div>
                          </div>
                          <div className="text-center">
                            <div className="text-lg font-bold text-indigo-600 dark:text-indigo-400">{pool.usedCount}</div>
                            <div className="text-xs text-slate-500 dark:text-slate-400">Used</div>
                          </div>
                        </div>
                        <div className="w-20">
                          <div className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                            <div
                              className={`h-full transition-all ${
                                utilizationPercent > 90
                                  ? 'bg-rose-500'
                                  : utilizationPercent > 70
                                    ? 'bg-amber-500'
                                    : 'bg-emerald-500'
                              }`}
                              style={{ width: `${utilizationPercent}%` }}
                            />
                          </div>
                          <div className="mt-1 text-center text-xs text-slate-500 dark:text-slate-400">
                            {utilizationPercent}%
                          </div>
                        </div>
                        <button
                          className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-900/20 dark:hover:text-rose-400"
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteMutation.mutate(pool.id);
                          }}
                          disabled={deleteMutation.isPending}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>

                    {isExpanded && pool.allocations && pool.allocations.length > 0 && (
                      <div className="border-t border-slate-100 bg-slate-50/50 dark:border-slate-700 dark:bg-slate-900/50">
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-b border-slate-100 dark:border-slate-700">
                                <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                  IP Address
                                </th>
                                <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                  Server
                                </th>
                                <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                  Status
                                </th>
                                <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                  Assigned
                                </th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                              {pool.allocations.map((alloc) => (
                                <tr key={alloc.id} className="hover:bg-white dark:hover:bg-slate-800">
                                  <td className="px-4 py-2 font-mono text-slate-900 dark:text-white">{alloc.ip}</td>
                                  <td className="px-4 py-2">
                                    {alloc.serverId ? (
                                      <Link
                                        to={`/servers/${alloc.serverId}`}
                                        className="inline-flex items-center gap-1 text-primary-600 hover:text-primary-500 dark:text-primary-400"
                                      >
                                        <Server className="h-3 w-3" />
                                        {alloc.serverName || 'Unknown'}
                                        <ExternalLink className="h-3 w-3" />
                                      </Link>
                                    ) : (
                                      <span className="text-slate-400 dark:text-slate-500">-</span>
                                    )}
                                  </td>
                                  <td className="px-4 py-2">
                                    {alloc.serverStatus ? (
                                      <Badge
                                        variant={
                                          alloc.serverStatus === 'running'
                                            ? 'default'
                                            : alloc.serverStatus === 'stopped'
                                              ? 'secondary'
                                              : 'outline'
                                        }
                                        className="text-xs"
                                      >
                                        {alloc.serverStatus}
                                      </Badge>
                                    ) : (
                                      <span className="text-slate-400 dark:text-slate-500">-</span>
                                    )}
                                  </td>
                                  <td className="px-4 py-2 text-xs text-slate-500 dark:text-slate-400">
                                    {new Date(alloc.createdAt).toLocaleDateString()}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {isExpanded && (!pool.allocations || pool.allocations.length === 0) && (
                      <div className="border-t border-slate-100 px-4 py-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                        No IPs allocated yet
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {allAllocations.length > 0 && searchIp && (
        <Card>
          <CardHeader className="border-b border-slate-100 dark:border-slate-800">
            <CardTitle className="text-lg">Search Results</CardTitle>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {allAllocations.length} allocation{allAllocations.length !== 1 ? 's' : ''} found
            </p>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-800/50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      IP Address
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      Node
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      Pool
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      Server
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {allAllocations.map((alloc) => (
                    <tr key={alloc.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <td className="px-4 py-3 font-mono text-slate-900 dark:text-white">{alloc.ip}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{alloc.nodeName}</td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-500 dark:text-slate-400">
                        {alloc.poolCidr}
                      </td>
                      <td className="px-4 py-3">
                        {alloc.serverId ? (
                          <Link
                            to={`/servers/${alloc.serverId}`}
                            className="inline-flex items-center gap-1 text-primary-600 hover:text-primary-500 dark:text-primary-400"
                          >
                            {alloc.serverName || 'Unknown'}
                            <ExternalLink className="h-3 w-3" />
                          </Link>
                        ) : (
                          <span className="text-slate-400 dark:text-slate-500">Unassigned</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default NetworkPage;

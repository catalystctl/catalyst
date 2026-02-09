import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { serversApi } from '../../services/api/servers';
import type { UpdateServerPayload } from '../../types/server';
import { useServer } from '../../hooks/useServer';
import { useWebSocketStore } from '../../stores/websocketStore';
import { notifyError, notifySuccess } from '../../utils/notify';
import { nodesApi } from '../../services/api/nodes';

type Props = {
  serverId: string;
  disabled?: boolean;
};

function UpdateServerModal({ serverId, disabled = false }: Props) {
  const [open, setOpen] = useState(false);
  const [memory, setMemory] = useState('1024');
  const [cpu, setCpu] = useState('1');
  const [disk, setDisk] = useState('10240');
  const [databaseAllocation, setDatabaseAllocation] = useState('0');
  const [name, setName] = useState('');
  const [primaryIp, setPrimaryIp] = useState('');
  const [allocationId, setAllocationId] = useState('');
  const [availableAllocations, setAvailableAllocations] = useState<
    Array<{ id: string; ip: string; port: number; alias?: string | null }>
  >([]);
  const [allocLoadError, setAllocLoadError] = useState<string | null>(null);
  const [availableIps, setAvailableIps] = useState<string[]>([]);
  const [ipLoadError, setIpLoadError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { data: server } = useServer(serverId);
  const { onMessage } = useWebSocketStore();

  const isRunning = server?.status !== 'stopped';
  const isIpamNetwork = server?.networkMode && !['bridge', 'host'].includes(server.networkMode);
  const isBridgeNetwork = server?.networkMode === 'bridge';
  const memoryValue = Number(memory);
  const cpuValue = Number(cpu);
  const diskValue = Number(disk);
  const existingMemoryMb = server?.allocatedMemoryMb ?? memoryValue;
  const existingCpuCores = server?.allocatedCpuCores ?? cpuValue;
  const existingDiskMb = server?.allocatedDiskMb ?? (diskValue || 10240);
  const isShrink = Number.isFinite(diskValue) && diskValue > 0 && diskValue < existingDiskMb;

  const mutation = useMutation({
    mutationFn: async () => {
      const updates: UpdateServerPayload = {};
      if (name && name !== server?.name) updates.name = name;
      if (Number.isFinite(memoryValue) && memoryValue > 0 && memoryValue !== existingMemoryMb) {
        updates.allocatedMemoryMb = memoryValue;
      }
      if (Number.isFinite(cpuValue) && cpuValue > 0 && cpuValue !== existingCpuCores) {
        updates.allocatedCpuCores = cpuValue;
      }
      const databaseAllocationValue =
        databaseAllocation.trim() === '' ? undefined : Number(databaseAllocation);
      if (
        databaseAllocationValue !== undefined &&
        Number.isFinite(databaseAllocationValue) &&
        databaseAllocationValue >= 0 &&
        databaseAllocationValue !== (server?.databaseAllocation ?? 0)
      ) {
        updates.databaseAllocation = databaseAllocationValue;
      }
      if (isIpamNetwork && primaryIp !== (server?.primaryIp ?? '')) {
        updates.primaryIp = primaryIp.trim() || null;
      }
      if (isBridgeNetwork && allocationId) {
        updates.allocationId = allocationId;
      }

      if (Object.keys(updates).length) {
        await serversApi.update(serverId, updates);
      }

      if (Number.isFinite(diskValue) && diskValue > 0 && diskValue !== existingDiskMb) {
        return serversApi.resizeStorage(serverId, diskValue);
      }
      return undefined;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['server', serverId] });
      queryClient.invalidateQueries({ queryKey: ['servers'] });
      notifySuccess(diskValue !== existingDiskMb ? 'Storage resize initiated' : 'Server updated');
      setOpen(false);
    },
    onError: () => notifyError('Failed to update server'),
  });

  useEffect(() => {
    if (!server) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setName(server.name ?? '');
    if (server.allocatedMemoryMb) setMemory(String(server.allocatedMemoryMb));
    if (server.allocatedCpuCores) setCpu(String(server.allocatedCpuCores));
    if (server.allocatedDiskMb) setDisk(String(server.allocatedDiskMb));
    setDatabaseAllocation(String(server.databaseAllocation ?? 0));
    setPrimaryIp(server.primaryIp ?? '');
    setAllocationId('');
  }, [server]);

  useEffect(() => {
    let active = true;
    if (!server?.nodeId || !isIpamNetwork) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAvailableIps([]);
      setIpLoadError(null);
      return () => {
        active = false;
      };
    }

    setIpLoadError(null);
    const networkName = server.networkMode?.trim() || 'mc-lan-static';
    nodesApi
      .availableIps(server.nodeId, networkName, 200)
      .then((ips) => {
        if (!active) return;
        setAvailableIps(ips);
      })
      .catch((error: any) => {
        if (!active) return;
        const message = error?.response?.data?.error || 'Unable to load IP pool';
        setAvailableIps([]);
        setIpLoadError(message);
      });

    return () => {
      active = false;
    };
  }, [server?.nodeId, server?.networkMode, isIpamNetwork]);

  useEffect(() => {
    let active = true;
    if (!server?.nodeId || !isBridgeNetwork) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAvailableAllocations([]);
      setAllocLoadError(null);
      return () => {
        active = false;
      };
    }
    setAllocLoadError(null);
    nodesApi
      .allocations(server.nodeId, { serverId: server.id })
      .then((allocations) => {
        if (!active) return;
        setAvailableAllocations(
          allocations.map((allocation) => ({
            id: allocation.id,
            ip: allocation.ip,
            port: allocation.port,
            alias: allocation.alias,
          })),
        );
        const current = allocations.find((allocation) => allocation.serverId === server.id);
        setAllocationId(current?.id ?? '');
      })
      .catch((error: any) => {
        if (!active) return;
        const message = error?.response?.data?.error || 'Unable to load allocations';
        setAvailableAllocations([]);
        setAllocLoadError(message);
      });

    return () => {
      active = false;
    };
  }, [server?.nodeId, server?.networkMode, server?.id, isBridgeNetwork]);

  useEffect(() => {
    const unsubscribe = onMessage((message) => {
      if (message.type !== 'storage_resize_complete' || message.serverId !== serverId) {
        return;
      }
      if (message.success) {
        notifySuccess('Storage resized');
      } else {
        notifyError(message.error || 'Storage resize failed');
      }
      queryClient.invalidateQueries({ queryKey: ['server', serverId] });
      queryClient.invalidateQueries({ queryKey: ['servers'] });
    });
    return unsubscribe;
  }, [onMessage, queryClient, serverId]);

  return (
    <div>
      <button
        className="rounded-md border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600 transition-all duration-300 hover:border-primary-500 hover:text-slate-900 disabled:opacity-60 dark:border-slate-800 dark:text-slate-300 dark:hover:border-primary-500/30"
        onClick={() => {
          if (!disabled) setOpen(true);
        }}
        disabled={disabled}
      >
        Update
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-950">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Update server</h2>
              <button
                className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 transition-all duration-300 hover:border-primary-500 hover:text-slate-900 dark:border-slate-800 dark:text-slate-300 dark:hover:border-primary-500/30"
                onClick={() => setOpen(false)}
              >
                Close
              </button>
            </div>
            <div className="mt-4 space-y-3 text-sm text-slate-900 dark:text-slate-100">
              <label className="block space-y-1">
                <span className="text-slate-600 dark:text-slate-300">Name</span>
                <input
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="minecraft-01"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-slate-600 dark:text-slate-300">Memory (MB)</span>
                <input
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400"
                  value={memory}
                  onChange={(e) => setMemory(e.target.value)}
                  type="number"
                  min={256}
                />
              </label>
              <label className="block space-y-1">
                <span className="text-slate-600 dark:text-slate-300">CPU cores</span>
                <input
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400"
                  value={cpu}
                  onChange={(e) => setCpu(e.target.value)}
                  type="number"
                  min={1}
                  step={1}
                />
              </label>
              <label className="block space-y-1">
                <span className="text-slate-600 dark:text-slate-300">Disk (MB)</span>
                <input
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400"
                  value={disk}
                  onChange={(e) => setDisk(e.target.value)}
                  type="number"
                  min={1024}
                  step={1024}
                />
                {isRunning && isShrink ? (
                  <span className="text-xs text-amber-600 dark:text-amber-300">
                    Shrinking requires the server to be stopped.
                  </span>
                ) : null}
              </label>
              <label className="block space-y-1">
                <span className="text-slate-600 dark:text-slate-300">Database allocation</span>
                <input
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400"
                  value={databaseAllocation}
                  onChange={(e) => setDatabaseAllocation(e.target.value)}
                  type="number"
                  min={0}
                  step={1}
                />
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  Set to 0 to disable database provisioning.
                </span>
              </label>
              {isIpamNetwork ? (
                <div className="space-y-2">
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Choose a primary IP or leave auto-assign selected.
                  </p>
                  <label className="block space-y-1">
                    <span className="text-slate-600 dark:text-slate-300">Primary IP allocation</span>
                    <select
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400"
                      value={primaryIp}
                      onChange={(event) => setPrimaryIp(event.target.value)}
                      disabled={isRunning}
                    >
                      <option value="">Auto-assign</option>
                      {server?.primaryIp ? (
                        <option value={server.primaryIp}>{server.primaryIp} (current)</option>
                      ) : null}
                      {availableIps
                        .filter((ip) => ip !== server?.primaryIp)
                        .map((ip) => (
                          <option key={ip} value={ip}>
                            {ip}
                          </option>
                        ))}
                    </select>
                  </label>
                  {ipLoadError ? <p className="text-xs text-amber-600 dark:text-amber-300">{ipLoadError}</p> : null}
                  {!ipLoadError && availableIps.length === 0 ? (
                    <p className="text-xs text-slate-500 dark:text-slate-500">No available IPs found.</p>
                  ) : null}
                </div>
              ) : isBridgeNetwork ? (
                <div className="space-y-2">
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Choose the primary allocation (IP:port) for this server.
                  </p>
                  <label className="block space-y-1">
                    <span className="text-slate-600 dark:text-slate-300">Primary allocation</span>
                    <select
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400"
                      value={allocationId}
                      onChange={(event) => setAllocationId(event.target.value)}
                      disabled={isRunning}
                    >
                      <option value="">Select allocation</option>
                      {availableAllocations.map((allocation) => (
                        <option key={allocation.id} value={allocation.id}>
                          {allocation.ip}:{allocation.port}
                          {allocation.alias ? ` (${allocation.alias})` : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                  {allocLoadError ? <p className="text-xs text-amber-600 dark:text-amber-300">{allocLoadError}</p> : null}
                  {!allocLoadError && availableAllocations.length === 0 ? (
                    <p className="text-xs text-slate-500 dark:text-slate-500">No allocations found.</p>
                  ) : null}
                </div>
              ) : null}
            </div>
            <div className="mt-4 flex justify-end gap-2 text-xs">
              <button
                className="rounded-md border border-slate-200 px-3 py-1 font-semibold text-slate-600 transition-all duration-300 hover:border-primary-500 hover:text-slate-900 dark:border-slate-800 dark:text-slate-300 dark:hover:border-primary-500/30"
                onClick={() => setOpen(false)}
              >
                Cancel
              </button>
              <button
                className="rounded-md bg-primary-600 px-4 py-2 font-semibold text-white shadow-lg shadow-primary-500/20 transition-all duration-300 hover:bg-primary-500 disabled:opacity-60"
                onClick={() => mutation.mutate()}
                disabled={mutation.isPending || (isRunning && isShrink) || disabled}
              >
                Save changes
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default UpdateServerModal;

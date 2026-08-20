import { useEffect, useState } from 'react';
import { useMutation } from '@/csync';
import { qk } from '@/lib/queryKeys';
import { queryClient } from '@/lib/queryClient';
import { serversApi } from '../../services/api/servers';
import type { UpdateServerPayload } from '../../types/server';
import { useServer } from '../../hooks/useServer';
import { useSseResizeComplete } from '../../hooks/useSseResizeComplete';
import { notifyError, notifySuccess } from '../../utils/notify';
import { nodesApi } from '../../services/api/nodes';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

type Props = {
  serverId: string;
  disabled?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

function UpdateServerModal({ serverId, disabled = false, open: controlledOpen, onOpenChange }: Props) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen !== undefined ? controlledOpen : internalOpen;
  const setOpen = (value: boolean) => {
    setInternalOpen(value);
    onOpenChange?.(value);
  };
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
  const { data: server } = useServer(serverId);
  useSseResizeComplete(serverId, () => {
    setOpen(false);
  });

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
      if (diskValue !== existingDiskMb) {
        notifySuccess('Storage resize initiated');
        // Wait for SSE event to close modal
      } else {
        notifySuccess('Server updated');
        setOpen(false);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: qk.server(serverId) });
      queryClient.invalidateQueries({ queryKey: qk.servers() });
    },
    onError: () => notifyError('Failed to update server'),
  });

  useEffect(() => {
    if (!open || !server) return;
    setName(server.name ?? '');
    setMemory(String(server.allocatedMemoryMb ?? 1024));
    setCpu(String(server.allocatedCpuCores ?? 1));
    setDisk(String(server.allocatedDiskMb ?? 10240));
    setDatabaseAllocation(String(server.databaseAllocation ?? 0));
    setPrimaryIp(server.primaryIp ?? '');
  }, [open, server]);

  const [prevIpDeps, setPrevIpDeps] = useState({
    nodeId: server?.nodeId,
    networkMode: server?.networkMode,
    isIpamNetwork,
  });
  if (
    prevIpDeps.nodeId !== server?.nodeId ||
    prevIpDeps.networkMode !== server?.networkMode ||
    prevIpDeps.isIpamNetwork !== isIpamNetwork
  ) {
    setPrevIpDeps({
      nodeId: server?.nodeId,
      networkMode: server?.networkMode,
      isIpamNetwork,
    });
    if (!server?.nodeId || !isIpamNetwork) {
      setAvailableIps([]);
      setIpLoadError(null);
    } else {
      setIpLoadError(null);
    }
  }

  useEffect(() => {
    if (!server?.nodeId || !isIpamNetwork) {
      return;
    }

    let active = true;
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

  const [prevAllocDeps, setPrevAllocDeps] = useState({
    nodeId: server?.nodeId,
    networkMode: server?.networkMode,
    serverId: server?.id,
    isBridgeNetwork,
  });
  if (
    prevAllocDeps.nodeId !== server?.nodeId ||
    prevAllocDeps.networkMode !== server?.networkMode ||
    prevAllocDeps.serverId !== server?.id ||
    prevAllocDeps.isBridgeNetwork !== isBridgeNetwork
  ) {
    setPrevAllocDeps({
      nodeId: server?.nodeId,
      networkMode: server?.networkMode,
      serverId: server?.id,
      isBridgeNetwork,
    });
    if (!server?.nodeId || !isBridgeNetwork) {
      setAvailableAllocations([]);
      setAllocLoadError(null);
    } else {
      setAllocLoadError(null);
    }
  }

  useEffect(() => {
    if (!server?.nodeId || !isBridgeNetwork) {
      return;
    }
    let active = true;
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

  // SSE resize handler closes the modal directly via the callback above

  return (
    <>
      {controlledOpen === undefined && (
        <button
          className="rounded-md border border-border px-3 py-1 text-xs font-semibold text-muted-foreground transition-all duration-300 hover:border-primary hover:text-foreground disabled:opacity-60 dark:border-border dark:hover:border-primary/30"
          onClick={() => {
            if (!disabled) setOpen(true);
          }}
          disabled={disabled}
        >
          Update
        </button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>Update server</DialogTitle>
            <DialogDescription>
              Change this server's name, resources, and network allocation.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="update-server-name">Name</Label>
              <Input
                id="update-server-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="minecraft-01"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="update-server-memory">Memory (MB)</Label>
              <Input
                id="update-server-memory"
                value={memory}
                onChange={(e) => setMemory(e.target.value)}
                type="number"
                min={256}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="update-server-cpu">CPU cores</Label>
              <Input
                id="update-server-cpu"
                value={cpu}
                onChange={(e) => setCpu(e.target.value)}
                type="number"
                min={1}
                step={1}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="update-server-disk">Disk (MB)</Label>
              <Input
                id="update-server-disk"
                value={disk}
                onChange={(e) => setDisk(e.target.value)}
                type="number"
                min={1024}
                step={1024}
              />
              {isRunning && isShrink ? (
                <span className="text-xs text-warning">
                  Shrinking requires the server to be stopped.
                </span>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="update-server-db">Database allocation</Label>
              <Input
                id="update-server-db"
                value={databaseAllocation}
                onChange={(e) => setDatabaseAllocation(e.target.value)}
                type="number"
                min={0}
                step={1}
              />
              <span className="text-xs text-muted-foreground">
                Set to 0 to disable database provisioning.
              </span>
            </div>
            {isIpamNetwork ? (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  Choose a primary IP or leave auto-assign selected.
                </p>
                <Label htmlFor="update-server-ip">Primary IP allocation</Label>
                <select
                  id="update-server-ip"
                  className="w-full rounded-lg border border-border bg-card px-3 py-2 text-foreground transition-all duration-300 focus:border-primary focus:outline-none dark:border-border dark:text-foreground"
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
                {ipLoadError ? <p className="text-xs text-warning">{ipLoadError}</p> : null}
                {!ipLoadError && availableIps.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No available IPs found.</p>
                ) : null}
              </div>
            ) : isBridgeNetwork ? (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  Choose the primary allocation (IP:port) for this server.
                </p>
                <Label htmlFor="update-server-alloc">Primary allocation</Label>
                <select
                  id="update-server-alloc"
                  className="w-full rounded-lg border border-border bg-card px-3 py-2 text-foreground transition-all duration-300 focus:border-primary focus:outline-none dark:border-border dark:text-foreground"
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
                {allocLoadError ? <p className="text-xs text-warning">{allocLoadError}</p> : null}
                {!allocLoadError && availableAllocations.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No allocations found.</p>
                ) : null}
              </div>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => mutation.mutate()}
              disabled={mutation.isPending || (isRunning && isShrink) || disabled}
            >
              Save changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default UpdateServerModal;

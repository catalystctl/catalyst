import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Copy } from 'lucide-react';
import { qk } from '@/lib/queryKeys';
import { queryClient } from '@/lib/queryClient';
import { serversApi } from '../../services/api/servers';
import { nodesApi } from '../../services/api/nodes';
import { adminApi } from '../../services/api/admin';
import { useAuthStore } from '../../stores/authStore';
import { notifyError, notifySuccess } from '../../utils/notify';
import { Button } from '@/components/ui/button';
import Combobox from '@/components/ui/combobox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import type { Server } from '../../types/server';
import type { CloneServerPayload } from '../../types/server';

type Props = {
  server: Server;
  disabled?: boolean;
};

function CloneServerDialog({ server, disabled = false }: Props) {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const [open, setOpen] = useState(false);

  const isAdmin =
    user?.permissions?.includes('*') ||
    user?.permissions?.includes('admin.write');

  // Fetch available nodes for the dropdown
  const { data: accessibleNodesData } = useQuery({
    queryKey: qk.accessibleNodes(),
    queryFn: async () => {
      const res = await fetch('/api/nodes/accessible', {
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to fetch accessible nodes');
      return res.json();
    },
    enabled: open,
  });

  const { data: allNodes } = useQuery({
    queryKey: qk.nodes(),
    queryFn: () => nodesApi.list(),
    enabled: open && isAdmin,
  });

  const availableNodes: Array<{ id: string; name: string }> =
    isAdmin
      ? (allNodes || [])
      : (accessibleNodesData?.nodes || []);

  // Fetch users for owner dropdown (admin only)
  const { data: usersData } = useQuery({
    queryKey: qk.adminUsers({ limit: 200 }),
    queryFn: () => adminApi.listUsers({ limit: 200 }),
    enabled: open && isAdmin,
  });

  const users = usersData?.users ?? [];
  const userOptions = users.map((u: any) => ({
    value: u.id,
    label: (
      <div className="flex items-center gap-2">
        <span className="font-medium">{u.username || u.email}</span>
        {u.username && <span className="text-muted-foreground">({u.email})</span>}
        <span className="ml-auto text-[10px] text-muted-foreground">{u.id.slice(0, 8)}…</span>
      </div>
    ),
    keywords: [u.username || '', u.email || '', u.id],
  }));

  // Form state — pre-populated from source server
  const [name, setName] = useState(`${server.name} Copy`);
  const [nodeId, setNodeId] = useState(server.nodeId);
  const [networkMode, setNetworkMode] = useState(server.networkMode || 'host');
  const [allocationId, setAllocationId] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [copyFiles, setCopyFiles] = useState(false);
  const [memoryMb, setMemoryMb] = useState(server.allocatedMemoryMb ?? 1024);
  const [cpuCores, setCpuCores] = useState(server.allocatedCpuCores ?? 1);
  const [diskMb, setDiskMb] = useState(server.allocatedDiskMb ?? 1024);

  // Load available allocations for the selected node in host mode
  const [availableAllocations, setAvailableAllocations] = useState<
    Array<{ id: string; ip: string; port: number; alias?: string | null }>
  >([]);
  const [allocLoadError, setAllocLoadError] = useState<string | null>(null);

  useEffect(() => {
    setAllocationId('');
    if (!nodeId || networkMode !== 'host') {
      setAvailableAllocations([]);
      setAllocLoadError(null);
      return;
    }
    let active = true;
    setAllocLoadError(null);
    nodesApi
      .allocations(nodeId)
      .then((allocations) => {
        if (!active) return;
        setAvailableAllocations(
          allocations
            .filter((allocation: any) => !allocation.serverId)
            .map((allocation: any) => ({
              id: allocation.id,
              ip: allocation.ip,
              port: allocation.port,
              alias: allocation.alias,
            })),
        );
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
  }, [nodeId, networkMode, open]);

  // Reset form only when dialog transitions from closed → open
  const prevOpenRef = useRef(false);
  useEffect(() => {
    if (open && !prevOpenRef.current) {
      setName(`${server.name} Copy`);
      setNodeId(server.nodeId);
      setNetworkMode(server.networkMode || 'host');
      setAllocationId('');
      setOwnerId('');
      setCopyFiles(false);
      setMemoryMb(server.allocatedMemoryMb ?? 1024);
      setCpuCores(server.allocatedCpuCores ?? 1);
      setDiskMb(server.allocatedDiskMb ?? 1024);
    }
    prevOpenRef.current = open;
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps -- intentionally only open; server read at transition time

  const canClone =
    user?.permissions?.includes('*') ||
    user?.permissions?.includes('server.create') ||
    isAdmin;

  const cloneMutation = useMutation({
    mutationFn: () => {
      const payload: CloneServerPayload = {
        name: name.trim() || undefined,
        nodeId: nodeId !== server.nodeId ? nodeId : undefined,
        networkMode: networkMode !== server.networkMode ? networkMode : undefined,
        allocationId: allocationId || undefined,
        ownerId: ownerId || undefined,
        copyFiles: copyFiles || undefined,
        allocatedMemoryMb: memoryMb !== server.allocatedMemoryMb ? memoryMb : undefined,
        allocatedCpuCores: cpuCores !== server.allocatedCpuCores ? cpuCores : undefined,
        allocatedDiskMb: diskMb !== server.allocatedDiskMb ? diskMb : undefined,
      };
      return serversApi.clone(server.id, payload);
    },
    onSuccess: (newServer) => {
      notifySuccess(copyFiles ? 'Server clone started — copying files...' : 'Server cloned successfully');
      setOpen(false);
      // Navigate to the new server's page
      if (newServer?.id) {
        navigate(`/servers/${newServer.id}`);
      }
    },
    onSettled: (newServer) => {
      queryClient.invalidateQueries({ queryKey: qk.servers() });
      queryClient.invalidateQueries({ queryKey: qk.server(server.id) });
      if (newServer?.id) {
        queryClient.invalidateQueries({ queryKey: qk.server(newServer.id) });
      }
    },
    onError: (error: any) => {
      notifyError(
        error?.response?.data?.error || 'Failed to clone server',
      );
    },
  });

  const isHostNetwork = networkMode === 'host';
  const needsAllocation = isHostNetwork;
  const allocationValid = !needsAllocation || allocationId;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled || !canClone}
          onClick={() => setOpen(true)}
        >
          Clone
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Clone Server</DialogTitle>
          <DialogDescription>
            Create a new server with the same configuration as {server.name}.
          </DialogDescription>
        </DialogHeader>

        {/* Warning banner */}
        <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <span className="text-muted-foreground">
            {copyFiles
              ? 'Files will be copied from the source server. The new server will be unavailable until the copy completes.'
              : 'This will create a new server with the same configuration. A fresh install will run on the new server.'}
          </span>
        </div>

        <div className="grid gap-4 py-2 max-h-[60vh] overflow-y-auto pr-1">
          {/* Name */}
          <div className="grid gap-2">
            <label htmlFor="clone-name" className="text-xs font-medium text-foreground">
              Name
            </label>
            <input
              id="clone-name"
              className="rounded-lg border border-border bg-card px-3 py-2 text-xs text-foreground transition-all duration-300 focus:border-primary focus:outline-none"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Server name"
            />
          </div>

          {/* Node */}
          <div className="grid gap-2">
            <label htmlFor="clone-node" className="text-xs font-medium text-foreground">
              Node
            </label>
            <select
              id="clone-node"
              className="rounded-lg border border-border bg-card px-3 py-2 text-xs text-foreground transition-all duration-300 focus:border-primary focus:outline-none"
              value={nodeId}
              onChange={(e) => setNodeId(e.target.value)}
            >
              {availableNodes.map((node) => (
                <option key={node.id} value={node.id}>
                  {node.name}
                </option>
              ))}
            </select>
          </div>

          {/* Network Mode */}
          <div className="grid gap-2">
            <label htmlFor="clone-network" className="text-xs font-medium text-foreground">
              Network Mode
            </label>
            <select
              id="clone-network"
              className="rounded-lg border border-border bg-card px-3 py-2 text-xs text-foreground transition-all duration-300 focus:border-primary focus:outline-none"
              value={networkMode}
              onChange={(e) => setNetworkMode(e.target.value)}
            >
              <option value="host">Host (port mapping)</option>
              <option value="bridge">Bridge</option>
              <option value="macvlan">Macvlan</option>
              <option value="mc-lan-static">MC LAN Static</option>
              <option value="mc-lan-dynamic">MC LAN Dynamic</option>
            </select>
          </div>

          {/* Allocation (host mode) */}
          {isHostNetwork && (
            <div className="grid gap-2">
              <label className="text-xs font-medium text-foreground">
                Network Allocation <span className="text-danger">*</span>
              </label>
              <select
                className="rounded-lg border border-border bg-card px-3 py-2 text-xs text-foreground transition-all duration-300 focus:border-primary focus:outline-none"
                value={allocationId}
                onChange={(e) => setAllocationId(e.target.value)}
              >
                <option value="">Select allocation</option>
                {availableAllocations.map((allocation) => (
                  <option key={allocation.id} value={allocation.id}>
                    {allocation.ip}:{allocation.port}
                    {allocation.alias ? ` (${allocation.alias})` : ''}
                  </option>
                ))}
              </select>
              {allocLoadError ? (
                <p className="text-xs text-warning">{allocLoadError}</p>
              ) : null}
              {!allocLoadError && availableAllocations.length === 0 && nodeId ? (
                <p className="text-xs text-muted-foreground">
                  No available allocations.{' '}
                  <a
                    href={`/admin/nodes/${nodeId}/allocations`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-primary hover:underline"
                  >
                    Create one →
                  </a>
                </p>
              ) : null}
            </div>
          )}

          {/* Server Owner (admin only) */}
          {isAdmin && (
            <div className="grid gap-2">
              <label className="text-xs font-medium text-foreground">
                Server Owner <span className="text-danger">*</span>
              </label>
              <Combobox
                value={ownerId}
                onChange={(val: string) => setOwnerId(val)}
                options={userOptions}
                placeholder="Select owner..."
                searchPlaceholder="Search by username, email, or ID..."
              />
              <p className="text-[11px] text-muted-foreground">
                The user who will own this server. If not set, you will be the owner.
              </p>
            </div>
          )}

          {/* Copy Files Toggle */}
          <div className="grid gap-2">
            <div className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2.5">
              <div className="flex items-center gap-2.5">
                <Copy className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-xs font-medium text-foreground">Copy Files</p>
                  <p className="text-[11px] text-muted-foreground">
                    Copy all files from the source server instead of running a fresh install
                  </p>
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={copyFiles}
                onClick={() => setCopyFiles(!copyFiles)}
                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary/30 focus:ring-offset-2 ${
                  copyFiles ? 'bg-primary' : 'bg-surface-3'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    copyFiles ? 'translate-x-4' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
            {copyFiles && (
              <p className="text-[11px] text-warning">
                The cloned server will be in "cloning" status while files are being transferred. It cannot be started until the copy completes.
              </p>
            )}
          </div>

          {/* Resources */}
          <div className="grid grid-cols-3 gap-3">
            <div className="grid gap-2">
              <label htmlFor="clone-memory" className="text-xs font-medium text-foreground">
                Memory (MB)
              </label>
              <input
                id="clone-memory"
                type="number"
                min={512}
                className="rounded-lg border border-border bg-card px-3 py-2 text-xs text-foreground transition-all duration-300 focus:border-primary focus:outline-none"
                value={memoryMb}
                onChange={(e) => setMemoryMb(Number(e.target.value))}
              />
            </div>
            <div className="grid gap-2">
              <label htmlFor="clone-cpu" className="text-xs font-medium text-foreground">
                CPU Cores
              </label>
              <input
                id="clone-cpu"
                type="number"
                min={1}
                className="rounded-lg border border-border bg-card px-3 py-2 text-xs text-foreground transition-all duration-300 focus:border-primary focus:outline-none"
                value={cpuCores}
                onChange={(e) => setCpuCores(Number(e.target.value))}
              />
            </div>
            <div className="grid gap-2">
              <label htmlFor="clone-disk" className="text-xs font-medium text-foreground">
                Disk (MB)
              </label>
              <input
                id="clone-disk"
                type="number"
                min={1024}
                className="rounded-lg border border-border bg-card px-3 py-2 text-xs text-foreground transition-all duration-300 focus:border-primary focus:outline-none"
                value={diskMb}
                onChange={(e) => setDiskMb(Number(e.target.value))}
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setOpen(false)}
            disabled={cloneMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={() => cloneMutation.mutate()}
            disabled={cloneMutation.isPending || !name.trim() || !allocationValid}
          >
            {cloneMutation.isPending ? 'Cloning...' : 'Clone Server'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default CloneServerDialog;

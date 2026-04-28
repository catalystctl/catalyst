import { useEffect, useMemo, useState } from 'react';
import { ModalPortal } from '@/components/ui/modal-portal';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { serversApi } from '../../services/api/servers';
import { useTemplates } from '../../hooks/useTemplates';
import { useNodes, useAccessibleNodes } from '../../hooks/useNodes';
import { notifyError, notifySuccess } from '../../utils/notify';
import { nodesApi } from '../../services/api/nodes';
import { useAuthStore } from '../../stores/authStore';
import Combobox from '@/components/ui/combobox';

function CreateServerModal() {
  const user = useAuthStore((s) => s.user);
  const { data: accessibleNodesData } = useAccessibleNodes();
  const accessibleNodes = accessibleNodesData?.nodes || [];
  const hasNodeWildcard = accessibleNodesData?.hasWildcard || false;

  const canCreateServer =
    user?.permissions?.includes('*') ||
    user?.permissions?.includes('admin.write') ||
    user?.permissions?.includes('server.create') ||
    hasNodeWildcard ||
    accessibleNodes.length > 0;

  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [nodeId, setNodeId] = useState('');
  const [description, setDescription] = useState('');
  const [memory, setMemory] = useState('1024');
  const [cpu, setCpu] = useState('1');
  const [disk, setDisk] = useState('10240');
  const [backupAllocationMb, setBackupAllocationMb] = useState('');
  const [databaseAllocation, setDatabaseAllocation] = useState('');
  const [allocatedSwapMb, setAllocatedSwapMb] = useState('');
  const [port, setPort] = useState('25565');
  const [additionalBindings, setAdditionalBindings] = useState<
    Array<{ allocationId: string; containerPort: string }>
  >([]);
  const [environment, setEnvironment] = useState<Record<string, string>>({});
  const [imageVariant, setImageVariant] = useState('');
  const [networkMode, setNetworkMode] = useState('host');
  const [macvlanInterface, setMacvlanInterface] = useState('');
  const [primaryIp, setPrimaryIp] = useState('');
  const [allocationId, setAllocationId] = useState('');
  const [availableAllocations, setAvailableAllocations] = useState<
    Array<{ id: string; ip: string; port: number; alias?: string | null }>
  >([]);
  const [allocLoadError, setAllocLoadError] = useState<string | null>(null);
  const [allocRefreshKey, setAllocRefreshKey] = useState(0);
  const [nodeIpPools, setNodeIpPools] = useState<
    Array<{ id: string; networkName: string; cidr: string; availableCount: number }>
  >([]);
  const [step, setStep] = useState<'details' | 'resources' | 'build' | 'startup'>('details');
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: templates = [] } = useTemplates();
  const { data: nodes = [] } = useNodes();
  const [availableIps, setAvailableIps] = useState<string[]>([]);
  const [ipLoadError, setIpLoadError] = useState<string | null>(null);

  const isAdmin = user?.permissions?.includes('*') || user?.permissions?.includes('admin.write');
  const availableNodes: Array<{ id: string; name: string; locationId?: string }> =
    isAdmin || hasNodeWildcard ? nodes : accessibleNodes;

  const selectedTemplate = useMemo(
    () => templates.find((t) => t.id === templateId),
    [templates, templateId],
  );

  // Auto-populate primary port from selected allocation in host mode
  useEffect(() => {
    if (networkMode === 'host' && allocationId) {
      const allocation = availableAllocations.find((a) => a.id === allocationId);
      if (allocation) {
        setPort(String(allocation.port));
      }
    }
  }, [allocationId, networkMode, availableAllocations]);

  // Clear additional bindings when switching away from host mode
  useEffect(() => {
    if (networkMode !== 'host') {
      setAdditionalBindings([]);
    }
  }, [networkMode]);

  // Set default port from template when template is selected
  useEffect(() => {
    if (selectedTemplate?.supportedPorts && selectedTemplate.supportedPorts.length > 0) {
      if (networkMode !== 'host' || !allocationId) {
        setPort(String(selectedTemplate.supportedPorts[0]));
      }
    }
  }, [selectedTemplate]);

  const templateVariables = useMemo(() => {
    if (!selectedTemplate?.variables) return [];
    return selectedTemplate.variables.filter((v) => v.name !== 'SERVER_DIR');
  }, [selectedTemplate]);

  const selectedNode = useMemo(
    () => availableNodes.find((node) => node.id === nodeId),
    [availableNodes, nodeId],
  );
  const locationId = selectedNode?.locationId || availableNodes[0]?.locationId || '';

  // Load macvlan interfaces (IP pools) for the selected node
  useEffect(() => {
    setMacvlanInterface('');
    setNodeIpPools([]);
    if (!nodeId || networkMode !== 'macvlan') return;
    let active = true;
    nodesApi
      .ipPools(nodeId)
      .then((pools) => {
        if (!active) return;
        setNodeIpPools(pools);
        if (pools.length === 1) setMacvlanInterface(pools[0].networkName);
      })
      .catch(() => {
        if (!active) return;
        setNodeIpPools([]);
      });
    return () => {
      active = false;
    };
  }, [nodeId, networkMode]);

  // Load available IPs when macvlan interface is selected
  useEffect(() => {
    setPrimaryIp('');
    if (!nodeId || networkMode !== 'macvlan' || !macvlanInterface) {
      setAvailableIps([]);
      setIpLoadError(null);
      return;
    }

    let active = true;
    setIpLoadError(null);
    nodesApi
      .availableIps(nodeId, macvlanInterface, 200)
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
  }, [nodeId, networkMode, macvlanInterface]);

  // Load allocations for host (port mapping) mode
  useEffect(() => {
    setAllocationId('');
    let active = true;
    if (!nodeId || networkMode !== 'host') {
      setAvailableAllocations([]);
      setAllocLoadError(null);
      return () => {
        active = false;
      };
    }
    setAllocLoadError(null);
    nodesApi
      .allocations(nodeId)
      .then((allocations) => {
        if (!active) return;
        setAvailableAllocations(
          allocations
            .filter((allocation) => !allocation.serverId)
            .map((allocation) => ({
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
  }, [nodeId, networkMode, allocRefreshKey]);

  // Auto-refresh allocations when user returns from another tab
  useEffect(() => {
    if (!nodeId || networkMode !== 'host') return;
    const onFocus = () => setAllocRefreshKey((k) => k + 1);
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [nodeId, networkMode]);

  const mutation = useMutation({
    mutationFn: async () => {
      const normalizedBindings = additionalBindings.reduce<Record<number, number>>(
        (acc, binding) => {
          const allocation = availableAllocations.find((a) => a.id === binding.allocationId);
          if (!allocation) return acc;
          const containerPort = Number(binding.containerPort);
          const hostPort = allocation.port;
          if (
            Number.isFinite(containerPort) &&
            Number.isFinite(hostPort) &&
            containerPort > 0 &&
            containerPort <= 65535 &&
            hostPort > 0 &&
            hostPort <= 65535
          ) {
            acc[containerPort] = hostPort;
          }
          return acc;
        },
        {},
      );

      const payload: Parameters<typeof serversApi.create>[0] = {
        name,
        description: description.trim() || undefined,
        templateId,
        nodeId,
        locationId,
        allocatedMemoryMb: Number(memory),
        allocatedCpuCores: Number(cpu),
        allocatedDiskMb: Number(disk),
        allocatedSwapMb: parsedSwap,
        backupAllocationMb:
          backupAllocationMb.trim() === '' ? undefined : Number(backupAllocationMb),
        databaseAllocation:
          databaseAllocation.trim() === '' ? undefined : Number(databaseAllocation),
        primaryPort: Number(port),
        portBindings: Object.keys(normalizedBindings).length ? normalizedBindings : undefined,
        networkMode: networkMode as
          | 'bridge'
          | 'macvlan'
          | 'host'
          | 'mc-lan-static'
          | 'mc-lan-dynamic',
        environment: Object.fromEntries(
          Object.entries({
            ...environment,
            ...(imageVariant ? { IMAGE_VARIANT: imageVariant } : {}),
          }).filter(([, v]) => v !== ''),
        ),
      };
      if (networkMode === 'macvlan') {
        payload.primaryIp = primaryIp.trim() || null;
      }
      if (networkMode === 'host' && allocationId) {
        payload.allocationId = allocationId;
      }

      const server = await serversApi.create(payload);

      if (server?.id) {
        await serversApi.install(server.id);
      }

      return server;
    },
    onSuccess: (server) => {
      queryClient.invalidateQueries({
        predicate: (query) => Array.isArray(query.queryKey) && query.queryKey[0] === 'servers',
      });
      notifySuccess('Server created and installation started');
      setOpen(false);
      setName('');
      setDescription('');
      setTemplateId('');
      setNodeId('');
      setEnvironment({});
      setImageVariant('');
      setNetworkMode('host');
      setMacvlanInterface('');
      setPrimaryIp('');
      setAdditionalBindings([]);
      setAllocatedSwapMb('');
      setBackupAllocationMb('');
      setDatabaseAllocation('');
      setStep('details');
      if (server?.id) {
        navigate(`/servers/${server.id}/console`);
      }
    },
    onError: (error: any) => {
      console.error('Server creation error:', error?.response?.data || error);
      const message = error?.response?.data?.error || 'Failed to create server';
      notifyError(message);
    },
  });

  const stepOrder = ['details', 'resources', 'build', 'startup'] as const;
  const stepIndex = stepOrder.indexOf(step);
  const parsedMemory = Number(memory);
  const parsedCpu = Number(cpu);
  const parsedDisk = Number(disk);
  const parsedPort = Number(port);
  const parsedSwap = allocatedSwapMb.trim() === '' ? undefined : Number(allocatedSwapMb);
  const detailsValid = Boolean(name.trim() && templateId && nodeId);
  const resourcesValid =
    Number.isFinite(parsedMemory) &&
    parsedMemory >= 256 &&
    Number.isFinite(parsedCpu) &&
    parsedCpu >= 1 &&
    Number.isFinite(parsedDisk) &&
    parsedDisk >= 1024 &&
    (parsedSwap === undefined || (Number.isFinite(parsedSwap) && parsedSwap >= 0));
  const buildValid = Number.isFinite(parsedPort) && parsedPort >= 1 && parsedPort <= 65535;
  const startupValid = !templateVariables.some((variable) => {
    if (!variable.required) return false;
    const value = environment[variable.name];
    return value === undefined || value === null || String(value).trim() === '';
  });
  const stepValidMap = {
    details: detailsValid,
    resources: resourcesValid,
    build: buildValid,
    startup: startupValid,
  } as const;
  const canGoNext = stepValidMap[step];
  const canNavigateTo = (targetIndex: number) =>
    targetIndex <= stepIndex || stepOrder.slice(0, targetIndex).every((key) => stepValidMap[key]);
  const disableSubmit =
    mutation.isPending ||
    !detailsValid ||
    !resourcesValid ||
    !buildValid ||
    !startupValid ||
    (networkMode === 'macvlan' && !macvlanInterface);

  if (!canCreateServer) {
    return null;
  }

  return (
    <>
      <style>{`
        @keyframes step-enter { from { opacity:0; transform:translateX(12px) } to { opacity:1; transform:translateX(0) } }
        @keyframes modal-in { from { opacity:0; transform:scale(0.97) translateY(10px) } to { opacity:1; transform:scale(1) translateY(0) } }
        .modal-enter { animation: modal-in .2s cubic-bezier(.16,1,.3,1) forwards }
        .step-content-enter { animation: step-enter .25s cubic-bezier(.16,1,.3,1) forwards }
      `}</style>

      <button
        className="flex items-center gap-2 rounded-lg bg-primary-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-primary-500/30 transition-all duration-300 hover:bg-primary-500 hover:shadow-xl hover:shadow-primary-500/40"
        onClick={() => { setStep('details'); setOpen(true); }}
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
        New Server
      </button>

      {open ? (
        <ModalPortal>
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-2 sm:px-4 backdrop-blur-sm">
            <div className="modal-enter w-full max-w-4xl max-h-[100dvh] sm:max-h-[90vh] rounded-none sm:rounded-2xl border-0 sm:border border-border bg-card shadow-2xl flex flex-col overflow-hidden dark:border-border dark:bg-card">

              {/* Header */}
              <div className="shrink-0 flex items-start justify-between gap-4 border-b border-border bg-gradient-to-r from-primary-500/[0.04] to-transparent px-5 sm:px-8 py-5 sm:py-6 dark:border-border">
                <div className="min-w-0">
                  <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground dark:text-white">
                    Create New Server
                  </h2>
                  <p className="mt-1 text-xs sm:text-sm text-muted-foreground dark:text-muted-foreground">
                    Deploy a new game server in just a few steps
                  </p>
                </div>
                <button
                  className="shrink-0 rounded-lg border border-border bg-card px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium text-muted-foreground transition-all duration-200 hover:border-danger/30 hover:bg-danger-muted hover:text-danger dark:border-border"
                  onClick={() => setOpen(false)}
                >
                  Cancel
                </button>
              </div>

              {/* Progress Stepper */}
              <div className="shrink-0 border-b border-border bg-muted/30 px-5 sm:px-8 py-3.5 dark:border-border dark:bg-muted/20">
                <div className="flex items-center">
                  {stepOrder.map((key, index) => {
                    const isActive = step === key;
                    const isCompleted = stepValidMap[key] && stepIndex > index;
                    const canNavigate = canNavigateTo(index);
                    const stepNames = { details: 'Details', resources: 'Resources', build: 'Network', startup: 'Startup' };
                    return (
                      <div key={key} className="flex flex-1 items-center min-w-0">
                        <button
                          type="button"
                          disabled={!canNavigate}
                          onClick={() => { if (canNavigate) setStep(key); }}
                          className={`flex items-center gap-2.5 transition-all duration-200 ${canNavigate ? 'cursor-pointer' : 'cursor-not-allowed opacity-40'}`}
                        >
                          <div className={`flex h-8 w-8 sm:h-9 sm:w-9 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold transition-all duration-300 ${
                            isActive ? 'border-primary bg-primary text-primary-foreground shadow-md shadow-primary/25' :
                            isCompleted ? 'border-success bg-success text-white' :
                            'border-border bg-card text-muted-foreground'
                          }`}>
                            {isCompleted ? (
                              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7"/></svg>
                            ) : (
                              index + 1
                            )}
                          </div>
                          <span className={`hidden sm:block text-xs font-semibold whitespace-nowrap ${
                            isActive ? 'text-primary dark:text-primary-400' : isCompleted ? 'text-foreground dark:text-zinc-300' : 'text-muted-foreground'
                          }`}>
                            {stepNames[key]}
                          </span>
                        </button>
                        {index < stepOrder.length - 1 && (
                          <div className={`mx-2 sm:mx-3 h-px flex-1 transition-all duration-500 ${isCompleted ? 'bg-success' : 'bg-border'}`}/>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Content Area */}
              <div className="flex-1 overflow-y-auto">
                <div key={step} className="step-content-enter px-5 sm:px-8 py-5 sm:py-6">
                  <div className="mx-auto max-w-2xl space-y-5">

                    {/* --- DETAILS STEP --- */}
                    {step === 'details' ? (
                      <div className="space-y-5">
                        <label className="block space-y-1.5">
                          <span className="text-sm font-semibold text-foreground dark:text-zinc-300">Server Name</span>
                          <input className="w-full rounded-lg border border-border bg-card px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground transition-all duration-200 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15 dark:border-border dark:text-foreground dark:focus:border-primary-400" value={name} onChange={(e) => setName(e.target.value)} placeholder="my-awesome-server"/>
                        </label>
                        <label className="block space-y-1.5">
                          <span className="text-sm font-semibold text-foreground dark:text-zinc-300">Description <span className="text-xs font-normal text-muted-foreground">(optional)</span></span>
                          <textarea rows={3} className="w-full rounded-lg border border-border bg-card px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground resize-none transition-all duration-200 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15 dark:border-border dark:text-foreground dark:focus:border-primary-400" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Add notes or description for this server..."/>
                        </label>
                        <div className="grid gap-4 sm:grid-cols-2">
                          <div className="space-y-1.5">
                            <span className="text-sm font-semibold text-foreground dark:text-zinc-300">Template</span>
                            <Combobox value={templateId} onChange={(newTemplateId) => { setTemplateId(newTemplateId); setImageVariant(''); const template = templates.find((t) => t.id === newTemplateId); if (template?.variables) { const defaultEnv: Record<string, string> = {}; template.variables.filter((v) => v.name !== 'SERVER_DIR').forEach((v) => { defaultEnv[v.name] = v.default; }); setEnvironment(defaultEnv); } else { setEnvironment({}); } }} options={templates.map((t) => ({ value: t.id, label: t.name, keywords: [t.name, t.description || ''].filter(Boolean) }))} placeholder="Select a template..." searchPlaceholder="Search templates..."/>
                          </div>
                          <div className="space-y-1.5">
                            <span className="text-sm font-semibold text-foreground dark:text-zinc-300">Node</span>
                            <Combobox value={nodeId} onChange={(newNodeId) => setNodeId(newNodeId)} options={availableNodes.map((n) => ({ value: n.id, label: n.name, keywords: [n.name] }))} placeholder="Select a node..." searchPlaceholder="Search nodes..."/>
                          </div>
                        </div>
                        {selectedTemplate?.images?.length ? (
                          <label className="block space-y-1.5">
                            <span className="text-sm font-semibold text-foreground dark:text-zinc-300">Image Variant</span>
                            <select className="w-full rounded-lg border border-border bg-card px-4 py-2.5 text-sm text-foreground transition-all duration-200 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15 dark:border-border dark:text-foreground dark:focus:border-primary-400" value={imageVariant} onChange={(e) => setImageVariant(e.target.value)}>
                              <option value="">Use default image</option>
                              {selectedTemplate.images.map((option) => (<option key={option.name} value={option.name}>{option.label ?? option.name}</option>))}
                            </select>
                          </label>
                        ) : null}
                      </div>
                    ) : null}

                    {/* --- RESOURCES STEP --- */}
                    {step === 'resources' ? (
                      <div className="space-y-5">
                        <div className="rounded-xl border border-border bg-card p-5 sm:p-6 shadow-sm dark:border-border dark:bg-card">
                          <h3 className="mb-5 text-sm font-bold tracking-tight text-foreground dark:text-white">Resource Allocation</h3>
                          <div className="grid gap-4 sm:grid-cols-3">
                            <label className="block space-y-1.5">
                              <span className="text-sm font-medium text-muted-foreground dark:text-zinc-300">Memory (MB)</span>
                              <input className="w-full rounded-lg border border-border bg-background px-3.5 py-2.5 text-sm text-foreground transition-all duration-200 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15 dark:border-border dark:text-foreground dark:focus:border-primary-400" value={memory} onChange={(e) => setMemory(e.target.value)} type="number" min={256}/>
                            </label>
                            <label className="block space-y-1.5">
                              <span className="text-sm font-medium text-muted-foreground dark:text-zinc-300">CPU Cores</span>
                              <input className="w-full rounded-lg border border-border bg-background px-3.5 py-2.5 text-sm text-foreground transition-all duration-200 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15 dark:border-border dark:text-foreground dark:focus:border-primary-400" value={cpu} onChange={(e) => setCpu(e.target.value)} type="number" min={1} step={1}/>
                            </label>
                            <label className="block space-y-1.5">
                              <span className="text-sm font-medium text-muted-foreground dark:text-zinc-300">Disk (MB)</span>
                              <input className="w-full rounded-lg border border-border bg-background px-3.5 py-2.5 text-sm text-foreground transition-all duration-200 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15 dark:border-border dark:text-foreground dark:focus:border-primary-400" value={disk} onChange={(e) => setDisk(e.target.value)} type="number" min={1024} step={1024}/>
                            </label>
                            <label className="block space-y-1.5">
                              <span className="text-sm font-medium text-muted-foreground dark:text-zinc-300">Swap (MB)</span>
                              <input className="w-full rounded-lg border border-border bg-background px-3.5 py-2.5 text-sm text-foreground transition-all duration-200 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15 dark:border-border dark:text-foreground dark:focus:border-primary-400" value={allocatedSwapMb} onChange={(e) => setAllocatedSwapMb(e.target.value)} type="number" min={0} step={128}/>
                              <p className="text-[11px] text-muted-foreground/70 dark:text-muted-foreground">Leave blank to use provider defaults.</p>
                            </label>
                            <label className="block space-y-1.5">
                              <span className="text-sm font-medium text-muted-foreground dark:text-zinc-300">Backup (MB)</span>
                              <input className="w-full rounded-lg border border-border bg-background px-3.5 py-2.5 text-sm text-foreground transition-all duration-200 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15 dark:border-border dark:text-foreground dark:focus:border-primary-400" value={backupAllocationMb} onChange={(e) => setBackupAllocationMb(e.target.value)} type="number" min={0} step={128}/>
                              <p className="text-[11px] text-muted-foreground/70 dark:text-muted-foreground">Leave blank to use provider defaults.</p>
                            </label>
                            <label className="block space-y-1.5">
                              <span className="text-sm font-medium text-muted-foreground dark:text-zinc-300">Database Allocation</span>
                              <input className="w-full rounded-lg border border-border bg-background px-3.5 py-2.5 text-sm text-foreground transition-all duration-200 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15 dark:border-border dark:text-foreground dark:focus:border-primary-400" value={databaseAllocation} onChange={(e) => setDatabaseAllocation(e.target.value)} type="number" min={0} step={1}/>
                              <p className="text-[11px] text-muted-foreground/70 dark:text-muted-foreground">Leave blank to use provider defaults.</p>
                            </label>
                          </div>
                        </div>
                      </div>
                    ) : null}

                    {/* --- NETWORK STEP --- */}
                    {step === 'build' ? (
                      <div className="space-y-5">
                        <label className="block space-y-1.5">
                          <span className="text-sm font-semibold text-foreground dark:text-zinc-300">Network Mode</span>
                          <select className="w-full rounded-lg border border-border bg-card px-4 py-2.5 text-sm text-foreground transition-all duration-200 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15 dark:border-border dark:text-foreground dark:focus:border-primary-400" value={networkMode} onChange={(e) => setNetworkMode(e.target.value)}>
                            <option value="host">Host (port mapping)</option>
                            <option value="macvlan">Macvlan</option>
                          </select>
                        </label>
                        <label className="block space-y-1.5">
                          <span className="text-sm font-semibold text-foreground dark:text-zinc-300">Primary Port</span>
                          <input className="w-full rounded-lg border border-border bg-card px-4 py-2.5 text-sm text-foreground transition-all duration-200 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15 dark:border-border dark:text-foreground dark:focus:border-primary-400 disabled:opacity-50" value={port} onChange={(e) => setPort(e.target.value)} type="number" min={1024} max={65535} readOnly={networkMode === 'host'} disabled={networkMode === 'host'}/>
                          <p className="text-[11px] text-muted-foreground/70 dark:text-muted-foreground">{networkMode === 'host' ? 'Auto-populated from the primary allocation below.' : 'Port the server will listen on.'}</p>
                        </label>

                        {networkMode === 'macvlan' ? (
                          <div className="rounded-xl border border-border bg-card p-5 shadow-sm space-y-4 dark:border-border dark:bg-card">
                            <h4 className="text-sm font-semibold text-foreground dark:text-zinc-200">Macvlan Configuration</h4>
                            <label className="block space-y-1.5">
                              <span className="text-sm font-medium text-muted-foreground dark:text-zinc-300">Interface</span>
                              <select className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-sm text-foreground transition-all duration-200 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15 dark:border-border dark:text-foreground dark:focus:border-primary-400" value={macvlanInterface} onChange={(e) => setMacvlanInterface(e.target.value)}>
                                <option value="">Select interface</option>
                                {nodeIpPools.map((pool) => (<option key={pool.id} value={pool.networkName}>{pool.networkName} — {pool.cidr} ({pool.availableCount} available)</option>))}
                              </select>
                            </label>
                            {nodeIpPools.length === 0 && nodeId ? (<p className="text-xs text-muted-foreground dark:text-muted-foreground">No macvlan interfaces configured for this node.</p>) : null}
                            {macvlanInterface ? (
                              <label className="block space-y-1.5">
                                <span className="text-sm font-medium text-muted-foreground dark:text-zinc-300">IP Allocation</span>
                                <select className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-sm text-foreground transition-all duration-200 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15 dark:border-border dark:text-foreground dark:focus:border-primary-400" value={primaryIp} onChange={(e) => setPrimaryIp(e.target.value)}>
                                  <option value="">Auto-assign</option>
                                  {availableIps.map((ip) => (<option key={ip} value={ip}>{ip}</option>))}
                                </select>
                                {ipLoadError ? (<p className="text-xs text-warning">{ipLoadError}</p>) : null}
                                {!ipLoadError && availableIps.length === 0 ? (<p className="text-xs text-muted-foreground dark:text-muted-foreground">No available IPs found.</p>) : null}
                              </label>
                            ) : null}
                          </div>
                        ) : null}

                        {networkMode === 'host' ? (
                          <div className="space-y-4">
                            <div className="rounded-xl border border-border bg-card p-5 shadow-sm space-y-3 dark:border-border dark:bg-card">
                              <div>
                                <h4 className="text-sm font-semibold text-foreground dark:text-zinc-200">Primary Allocation</h4>
                                <p className="mt-0.5 text-xs text-muted-foreground dark:text-muted-foreground">Choose a node allocation for the default IP and port.</p>
                              </div>
                              <label className="block space-y-1.5">
                                <span className="text-sm font-medium text-muted-foreground dark:text-zinc-300">Allocation</span>
                                <div className="flex flex-col sm:flex-row gap-2">
                                  <select className="flex-1 rounded-lg border border-border bg-background px-4 py-2.5 text-sm text-foreground transition-all duration-200 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15 dark:border-border dark:text-foreground dark:focus:border-primary-400" value={allocationId} onChange={(event) => setAllocationId(event.target.value)}>
                                    <option value="">Select allocation</option>
                                    {availableAllocations.map((allocation) => (<option key={allocation.id} value={allocation.id}>{allocation.ip}:{allocation.port}{allocation.alias ? ` (${allocation.alias})` : ''}</option>))}
                                  </select>
                                  <a href={`/admin/nodes/${nodeId}/allocations`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 shrink-0 rounded-lg border border-border bg-card px-4 py-2.5 text-xs font-medium text-muted-foreground transition-all duration-200 hover:border-primary-500 hover:text-primary-600 dark:border-border dark:hover:border-primary/30 dark:hover:text-primary-400" title="Create allocations — refreshes on return">
                                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4"/></svg> New
                                  </a>
                                </div>
                              </label>
                              {allocLoadError ? (<p className="text-xs text-warning">{allocLoadError}</p>) : null}
                              {!allocLoadError && availableAllocations.length === 0 ? (
                                <p className="text-xs text-muted-foreground dark:text-muted-foreground">No available allocations.{' '}<a href={`/admin/nodes/${nodeId}/allocations`} target="_blank" rel="noopener noreferrer" className="font-medium text-primary hover:underline">Create one →</a></p>
                              ) : null}
                            </div>

                            <div className="rounded-xl border border-border bg-card p-5 shadow-sm space-y-3 dark:border-border dark:bg-card">
                              <div>
                                <h4 className="text-sm font-semibold text-foreground dark:text-zinc-200">Additional Port Bindings</h4>
                                <p className="mt-0.5 text-xs text-muted-foreground dark:text-muted-foreground">Map additional allocations to container ports.</p>
                              </div>
                              <div className="space-y-2.5">
                                {additionalBindings.map((binding, index) => (
                                  <div key={`${binding.allocationId}-${index}`} className="flex flex-col sm:flex-row gap-2">
                                    <select className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground transition-all duration-200 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15 dark:border-border dark:text-foreground dark:focus:border-primary-400" value={binding.allocationId} onChange={(event) => { const next = [...additionalBindings]; const allocation = availableAllocations.find((a) => a.id === event.target.value); next[index] = { allocationId: event.target.value, containerPort: allocation ? String(allocation.port) : binding.containerPort }; setAdditionalBindings(next); }}>
                                      <option value="">Select allocation</option>
                                      {availableAllocations.filter((a) => a.id !== allocationId && !additionalBindings.some((b, i) => i !== index && b.allocationId === a.id)).map((allocation) => (<option key={allocation.id} value={allocation.id}>{allocation.ip}:{allocation.port}{allocation.alias ? ` (${allocation.alias})` : ''}</option>))}
                                    </select>
                                    <div className="flex gap-2">
                                      <input className="w-full sm:w-24 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground transition-all duration-200 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15 dark:border-border dark:text-foreground dark:focus:border-primary-400" type="number" min={1} max={65535} value={binding.containerPort} onChange={(event) => { const next = [...additionalBindings]; next[index] = { ...next[index], containerPort: event.target.value }; setAdditionalBindings(next); }} placeholder="Port"/>
                                      <button type="button" className="shrink-0 rounded-lg border border-danger/20 px-2.5 py-2 text-xs font-semibold text-danger transition-all duration-200 hover:border-danger/40 hover:bg-danger-muted" onClick={() => { setAdditionalBindings(additionalBindings.filter((_, i) => i !== index)); }}>Remove</button>
                                    </div>
                                  </div>
                                ))}
                                <button type="button" className="rounded-lg border border-dashed border-border bg-transparent px-4 py-2 text-xs font-medium text-muted-foreground transition-all duration-200 hover:border-primary/40 hover:text-primary dark:hover:border-primary/30 dark:hover:text-primary-400" onClick={() => setAdditionalBindings([...additionalBindings, { allocationId: '', containerPort: '' }])}>
                                  + Add binding
                                </button>
                              </div>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ) : null}

                    {/* --- STARTUP STEP --- */}
                    {step === 'startup' ? (
                      <>
                        {templateVariables.length > 0 ? (
                          <div className="space-y-4">
                            <h3 className="text-sm font-semibold text-foreground dark:text-zinc-200">Environment Variables</h3>
                            {templateVariables.map((variable) => (
                              <label key={variable.name} className="block space-y-1.5">
                                <span className="text-sm font-medium text-muted-foreground dark:text-zinc-300">{variable.name}{variable.required ? <span className="ml-1 text-danger">*</span> : null}</span>
                                {variable.description ? (<p className="text-xs text-muted-foreground dark:text-muted-foreground">{variable.description}</p>) : null}
                                {variable.input === 'checkbox' ? (
                                  <input type="checkbox" className="h-4 w-4 rounded border-border bg-card text-primary focus:ring-primary/30 focus:ring-offset-0 dark:border-border dark:bg-surface-1 dark:text-primary-400" checked={environment[variable.name] === 'true' || environment[variable.name] === '1'} onChange={(e) => { const useNumeric = variable.default === '1' || variable.default === '0'; setEnvironment((prev) => ({ ...prev, [variable.name]: e.target.checked ? (useNumeric ? '1' : 'true') : (useNumeric ? '0' : 'false') })); }}/>
                                ) : (
                                  <input className="w-full rounded-lg border border-border bg-card px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground transition-all duration-200 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15 dark:border-border dark:text-foreground dark:focus:border-primary-400" type={variable.input === 'number' ? 'number' : 'text'} value={environment[variable.name] || ''} onChange={(e) => setEnvironment((prev) => ({ ...prev, [variable.name]: e.target.value }))} placeholder={variable.default}/>
                                )}
                              </label>
                            ))}
                          </div>
                        ) : (
                          <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground dark:border-border dark:bg-muted/20 dark:text-muted-foreground">No startup variables for this template.</div>
                        )}
                      </>
                    ) : null}

                  </div>
                </div>
              </div>

              {/* Footer */}
              <div className="shrink-0 border-t border-border bg-muted/30 px-5 sm:px-8 py-4 dark:border-border dark:bg-muted/20">
                <div className="flex items-center justify-between gap-3">
                  <button className="rounded-lg border border-border bg-card px-4 py-2.5 text-sm font-semibold text-muted-foreground transition-all duration-200 hover:border-danger/30 hover:bg-danger-muted hover:text-danger dark:border-border" onClick={() => setOpen(false)}>
                    Cancel
                  </button>
                  <div className="flex items-center gap-2.5">
                    {stepIndex > 0 ? (
                      <button className="rounded-lg border border-border bg-card px-4 py-2.5 text-sm font-semibold text-foreground transition-all duration-200 hover:border-primary/30 hover:bg-primary-muted hover:text-primary dark:border-border" onClick={() => setStep(stepOrder[stepIndex - 1])}>
                        Back
                      </button>
                    ) : null}
                    {stepIndex < stepOrder.length - 1 ? (
                      <button className="rounded-lg bg-primary-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-primary-500/25 transition-all duration-200 hover:bg-primary-500 disabled:opacity-50" onClick={() => setStep(stepOrder[stepIndex + 1])} disabled={!canGoNext}>
                        Next →
                      </button>
                    ) : (
                      <button className="rounded-lg bg-primary-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-primary-500/25 transition-all duration-200 hover:bg-primary-500 disabled:opacity-50" onClick={() => mutation.mutate()} disabled={disableSubmit}>
                        {mutation.isPending ? 'Creating...' : 'Create Server'}
                      </button>
                    )}
                  </div>
                </div>
              </div>

            </div>
          </div>
        </ModalPortal>
      ) : null}
    </>
  );
}

export default CreateServerModal;

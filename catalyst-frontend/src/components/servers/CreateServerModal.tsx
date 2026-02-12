import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { serversApi } from '../../services/api/servers';
import { useTemplates } from '../../hooks/useTemplates';
import { useNodes, useAccessibleNodes } from '../../hooks/useNodes';
import { notifyError, notifySuccess } from '../../utils/notify';
import type { Template } from '../../types/template';
import { nodesApi } from '../../services/api/nodes';
import { useAuthStore } from '../../stores/authStore';

function CreateServerModal() {
  const { user } = useAuthStore();
  const { data: accessibleNodesData } = useAccessibleNodes();
  const accessibleNodes = accessibleNodesData?.nodes || [];
  const hasNodeWildcard = accessibleNodesData?.hasWildcard || false;

  // User can create server if they have explicit permission OR have access to any node
  const canCreateServer =
    user?.permissions?.includes('*') ||
    user?.permissions?.includes('admin.write') ||
    user?.permissions?.includes('server.create') ||
    hasNodeWildcard ||
    accessibleNodes.length > 0;

  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [templateSearch, setTemplateSearch] = useState('');
  const [nodeId, setNodeId] = useState('');
  const [description, setDescription] = useState('');
  const [memory, setMemory] = useState('1024');
  const [cpu, setCpu] = useState('1');
  const [disk, setDisk] = useState('10240');
  const [backupAllocationMb, setBackupAllocationMb] = useState('');
  const [databaseAllocation, setDatabaseAllocation] = useState('');
  const [port, setPort] = useState('25565');
  const [portBindings, setPortBindings] = useState<string[]>([]);
  const [environment, setEnvironment] = useState<Record<string, string>>({});
  const [imageVariant, setImageVariant] = useState('');
  const [networkMode, setNetworkMode] = useState('macvlan');
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

  // Determine which nodes to show - accessible nodes for non-admins, all nodes for admins or wildcard users
  const isAdmin = user?.permissions?.includes('*') || user?.permissions?.includes('admin.write');
  const availableNodes = isAdmin || hasNodeWildcard ? nodes : accessibleNodes;

  // Get selected template
  const selectedTemplate = useMemo(() => templates.find(t => t.id === templateId), [templates, templateId]);

  // Filter templates by search
  const filteredTemplates = useMemo(() => {
    if (!templateSearch.trim()) return templates;
    const search = templateSearch.toLowerCase();
    return templates.filter(t =>
      t.name.toLowerCase().includes(search) ||
      (t.description && t.description.toLowerCase().includes(search))
    );
  }, [templates, templateSearch]);

  // Set default port from template when template is selected
  useEffect(() => {
    if (selectedTemplate?.supportedPorts && selectedTemplate.supportedPorts.length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPort(String(selectedTemplate.supportedPorts[0]));
    }
  }, [selectedTemplate]);

  // Filter out SERVER_DIR from variables
  const templateVariables = useMemo(() => {
    if (!selectedTemplate?.variables) return [];
    return selectedTemplate.variables.filter(v => v.name !== 'SERVER_DIR');
  }, [selectedTemplate]);

  const selectedNode = useMemo(() => availableNodes.find((node) => node.id === nodeId), [availableNodes, nodeId]);
  const locationId = selectedNode?.locationId || availableNodes[0]?.locationId || '';

  // Load macvlan interfaces (IP pools) for the selected node
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
    return () => { active = false; };
  }, [nodeId, networkMode]);

  // Load available IPs when macvlan interface is selected
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
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

    return () => { active = false; };
  }, [nodeId, networkMode, macvlanInterface]);

  // Load allocations for host (port mapping) mode
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAllocationId('');
    let active = true;
    if (!nodeId || networkMode !== 'host') {
      setAvailableAllocations([]);
      setAllocLoadError(null);
      return () => { active = false; };
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
    return () => { active = false; };
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
      // Create server first
      const normalizedBindings = portBindings
        .map(binding => binding.trim())
        .filter(Boolean)
        .reduce<Record<number, number>>((acc, binding) => {
          const [containerPortRaw, hostPortRaw] = binding.split(':');
          const containerPort = Number(containerPortRaw);
          const hostPort = Number(hostPortRaw ?? containerPortRaw);
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
        }, {});

        const payload: Parameters<typeof serversApi.create>[0] = {
          name,
          description: description.trim() || undefined,
          templateId,
          nodeId,
        locationId,
        allocatedMemoryMb: Number(memory),
          allocatedCpuCores: Number(cpu),
          allocatedDiskMb: Number(disk),
          backupAllocationMb:
            backupAllocationMb.trim() === '' ? undefined : Number(backupAllocationMb),
          databaseAllocation:
            databaseAllocation.trim() === '' ? undefined : Number(databaseAllocation),
        primaryPort: Number(port),
        portBindings: Object.keys(normalizedBindings).length ? normalizedBindings : undefined,
        networkMode: networkMode === 'macvlan' ? macvlanInterface : 'bridge',
        environment: {
          ...environment,
          ...(imageVariant ? { IMAGE_VARIANT: imageVariant } : {}),
        },
      };
      if (networkMode === 'macvlan') {
        payload.primaryIp = primaryIp.trim() || null;
      }
      if (networkMode === 'host' && allocationId) {
        payload.allocationId = allocationId;
      }

      const server = await serversApi.create(payload);
      
      // Then trigger installation
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
      setTemplateSearch('');
      setNodeId('');
      setEnvironment({});
      setImageVariant('');
      setNetworkMode('macvlan');
      setMacvlanInterface('');
      setPrimaryIp('');
      setPortBindings([]);
      setBackupAllocationMb('');
      setDatabaseAllocation('');
      setStep('details');
      if (server?.id) {
        navigate(`/servers/${server.id}/console`);
      }
    },
    onError: (error: any) => {
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
  const detailsValid = Boolean(name.trim() && templateId && nodeId);
  const resourcesValid =
    Number.isFinite(parsedMemory) &&
    parsedMemory >= 256 &&
    Number.isFinite(parsedCpu) &&
    parsedCpu >= 1 &&
    Number.isFinite(parsedDisk) &&
    parsedDisk >= 1024;
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
    targetIndex <= stepIndex ||
    stepOrder.slice(0, targetIndex).every((key) => stepValidMap[key]);
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
      <button
        className="flex items-center gap-2 rounded-lg bg-primary-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-primary-500/30 transition-all duration-300 hover:bg-primary-500 hover:shadow-xl hover:shadow-primary-500/40"
        onClick={() => {
          setStep('details');
          setOpen(true);
        }}
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
        New Server
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm">
          <div className="w-full max-w-4xl max-h-[90vh] rounded-2xl border border-slate-200 bg-white shadow-2xl flex flex-col dark:border-slate-800 dark:bg-slate-950">
            {/* Header */}
            <div className="relative flex items-center justify-between border-b border-slate-200 bg-gradient-to-r from-primary-500/5 to-transparent px-8 py-6 dark:border-slate-800">
              <div>
                <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Create New Server</h2>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                  Deploy a new game server in just a few steps
                </p>
              </div>
              <button
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 transition-all duration-300 hover:border-rose-300 hover:bg-rose-50 hover:text-rose-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-rose-500/30 dark:hover:bg-rose-950/20 dark:hover:text-rose-400"
                onClick={() => setOpen(false)}
              >
                Cancel
              </button>
            </div>

            {/* Progress Stepper */}
            <div className="border-b border-slate-200 bg-slate-50/50 px-8 py-4 dark:border-slate-800 dark:bg-slate-950/30">
              <div className="flex items-center justify-between">
                {stepOrder.map((key, index) => {
                  const isActive = step === key;
                  const isCompleted = stepValidMap[key] && stepIndex > index;
                  const canNavigate = canNavigateTo(index);
                  
                  const stepNames = {
                    details: 'Details',
                    resources: 'Resources',
                    build: 'Network',
                    startup: 'Startup',
                  };

                  return (
                    <div key={key} className="flex flex-1 items-center">
                      <button
                        type="button"
                        disabled={!canNavigate}
                        onClick={() => {
                          if (canNavigate) setStep(key);
                        }}
                        className={`group flex items-center gap-3 transition-all duration-300 ${
                          canNavigate ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'
                        }`}
                      >
                        <div className={`flex h-10 w-10 items-center justify-center rounded-full border-2 font-semibold transition-all duration-300 ${
                          isActive
                            ? 'border-primary-500 bg-primary-500 text-white shadow-lg shadow-primary-500/50'
                            : isCompleted
                              ? 'border-emerald-500 bg-emerald-500 text-white'
                              : 'border-slate-300 bg-white text-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-500'
                        }`}>
                          {isCompleted ? (
                            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                            </svg>
                          ) : (
                            <span className="text-sm">{index + 1}</span>
                          )}
                        </div>
                        <div className="hidden text-left sm:block">
                          <div className="text-xs font-medium text-slate-500 dark:text-slate-500">Step {index + 1}</div>
                          <div className={`text-sm font-semibold ${
                            isActive ? 'text-primary-600 dark:text-primary-400' : 'text-slate-700 dark:text-slate-300'
                          }`}>
                            {stepNames[key]}
                          </div>
                        </div>
                      </button>
                      {index < stepOrder.length - 1 && (
                        <div className={`mx-2 h-0.5 flex-1 transition-all duration-300 ${
                          isCompleted ? 'bg-emerald-500' : 'bg-slate-200 dark:bg-slate-800'
                        }`} />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Content Area */}
            <div className="flex-1 overflow-y-auto px-8 py-6">
              <div className="mx-auto max-w-2xl space-y-5">
                <>
                  {step === 'details' ? (
                    <div className="space-y-5">
                      <label className="block space-y-2">
                        <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">Server Name</span>
                        <input
                          className="w-full rounded-lg border border-slate-200 bg-white px-4 py-3 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400"
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          placeholder="my-awesome-server"
                        />
                      </label>
                      <label className="block space-y-2">
                        <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">Description <span className="text-xs font-normal text-slate-500">(optional)</span></span>
                        <textarea
                          rows={3}
                          className="w-full rounded-lg border border-slate-200 bg-white px-4 py-3 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400"
                          value={description}
                          onChange={(e) => setDescription(e.target.value)}
                          placeholder="Add notes or description for this server..."
                        />
                      </label>
                      <div className="grid gap-5 md:grid-cols-2">
                        <label className="block space-y-2">
                          <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">Template</span>
                          <input
                            type="text"
                            placeholder="Search templates..."
                            value={templateSearch}
                            onChange={(e) => setTemplateSearch(e.target.value)}
                            className="mb-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                          />
                          <select
                            className="w-full rounded-lg border border-slate-200 bg-white px-4 py-3 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400"
                            value={templateId}
                            onChange={(e) => {
                              const newTemplateId = e.target.value;
                              setTemplateId(newTemplateId);
                              setImageVariant('');
                              const template = templates.find((t) => t.id === newTemplateId);
                              if (template?.variables) {
                                const defaultEnv: Record<string, string> = {};
                                template.variables
                                  .filter((v) => v.name !== 'SERVER_DIR')
                                  .forEach((v) => {
                                    defaultEnv[v.name] = v.default;
                                  });
                                setEnvironment(defaultEnv);
                              } else {
                                setEnvironment({});
                              }
                            }}
                          >
                            <option value="">Select a template...</option>
                            {filteredTemplates.length === 0 ? (
                              <option disabled>No templates found</option>
                            ) : (
                              filteredTemplates.map((t) => (
                                <option key={t.id} value={t.id}>
                                  {t.name}
                                </option>
                              ))
                            )}
                          </select>
                        </label>
                        <label className="block space-y-2">
                          <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">Node</span>
                          <select
                            className="w-full rounded-lg border border-slate-200 bg-white px-4 py-3 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400"
                            value={nodeId}
                            onChange={(e) => setNodeId(e.target.value)}
                          >
                            <option value="">Select a node...</option>
                            {availableNodes.map((n) => (
                              <option key={n.id} value={n.id}>
                                {n.name}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                      {selectedTemplate?.images?.length ? (
                        <label className="block space-y-2">
                          <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">Image Variant</span>
                          <select
                            className="w-full rounded-lg border border-slate-200 bg-white px-4 py-3 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400"
                            value={imageVariant}
                            onChange={(e) => setImageVariant(e.target.value)}
                          >
                            <option value="">Use default image</option>
                            {selectedTemplate.images.map((option) => (
                              <option key={option.name} value={option.name}>
                                {option.label ?? option.name}
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : null}
                    </div>
                  ) : null}
                  {step === 'resources' ? (
                    <div className="space-y-5">
                      <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">Resource Allocation</h3>
                      <div className="grid gap-5 md:grid-cols-3">
                        <label className="block space-y-2">
                          <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">Memory (MB)</span>
                          <input
                            className="w-full rounded-lg border border-slate-200 bg-white px-4 py-3 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400"
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
                      </label>
                      <label className="block space-y-1">
                        <span className="text-slate-600 dark:text-slate-300">Backup allocation (MB)</span>
                        <input
                          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400"
                          value={backupAllocationMb}
                          onChange={(e) => setBackupAllocationMb(e.target.value)}
                          type="number"
                          min={0}
                          step={128}
                        />
                        <span className="text-xs text-slate-500 dark:text-slate-400">
                          Leave blank to use provider allocation defaults.
                        </span>
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
                          Leave blank to use provider allocation defaults.
                        </span>
                      </label>
                    </div>
                    </div>
                  ) : null}
                  {step === 'build' ? (
                    <>
                      <label className="block space-y-1">
                        <span className="text-slate-600 dark:text-slate-300">Primary Port</span>
                        <input
                          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400"
                          value={port}
                          onChange={(e) => setPort(e.target.value)}
                          type="number"
                          min={1024}
                          max={65535}
                        />
                      </label>
                      <label className="block space-y-1">
                        <span className="text-slate-600 dark:text-slate-300">Additional port bindings</span>
                        <div className="space-y-2 text-xs text-slate-500 dark:text-slate-400">
                          <p>Format: container:host (example: 25566:25570). Host defaults to container.</p>
                          {portBindings.map((binding, index) => (
                            <div key={`${binding}-${index}`} className="flex items-center gap-2">
                              <input
                                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400"
                                value={binding}
                                onChange={(event) => {
                                  const next = [...portBindings];
                                  next[index] = event.target.value;
                                  setPortBindings(next);
                                }}
                                placeholder="25566:25570"
                              />
                              <button
                                type="button"
                                className="rounded-md border border-rose-200 px-2 py-1 text-[10px] font-semibold text-rose-600 transition-all duration-300 hover:border-rose-400 dark:border-rose-500/30 dark:text-rose-300"
                                onClick={() => {
                                  setPortBindings(portBindings.filter((_, i) => i !== index));
                                }}
                              >
                                Remove
                              </button>
                            </div>
                          ))}
                          <button
                            type="button"
                            className="rounded-md border border-slate-200 px-3 py-1 text-xs text-slate-600 transition-all duration-300 hover:border-primary-500 hover:text-slate-900 dark:border-slate-800 dark:text-slate-300 dark:hover:border-primary-500/30"
                            onClick={() => setPortBindings([...portBindings, ''])}
                          >
                            Add binding
                          </button>
                        </div>
                      </label>
                      <label className="block space-y-1">
                        <span className="text-slate-600 dark:text-slate-300">Network</span>
                          <select
                            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400"
                            value={networkMode}
                            onChange={(e) => setNetworkMode(e.target.value)}
                          >
                            <option value="macvlan">Macvlan</option>
                            <option value="host">Host (port mapping)</option>
                          </select>
                        </label>
                      {networkMode === 'macvlan' ? (
                        <div className="space-y-3">
                          <label className="block space-y-1">
                            <span className="text-slate-600 dark:text-slate-300">Macvlan interface</span>
                            <select
                              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400"
                              value={macvlanInterface}
                              onChange={(e) => setMacvlanInterface(e.target.value)}
                            >
                              <option value="">Select interface</option>
                              {nodeIpPools.map((pool) => (
                                <option key={pool.id} value={pool.networkName}>
                                  {pool.networkName} — {pool.cidr} ({pool.availableCount} available)
                                </option>
                              ))}
                            </select>
                          </label>
                          {nodeIpPools.length === 0 && nodeId ? (
                            <p className="text-xs text-slate-500 dark:text-slate-500">
                              No macvlan interfaces configured for this node.
                            </p>
                          ) : null}
                          {macvlanInterface ? (
                            <div className="space-y-2">
                              <label className="block space-y-1">
                                <span className="text-slate-600 dark:text-slate-300">IP allocation</span>
                                <select
                                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400"
                                  value={primaryIp}
                                  onChange={(e) => setPrimaryIp(e.target.value)}
                                >
                                  <option value="">Auto-assign</option>
                                  {availableIps.map((ip) => (
                                    <option key={ip} value={ip}>
                                      {ip}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              {ipLoadError ? (
                                <p className="text-xs text-amber-600 dark:text-amber-300">{ipLoadError}</p>
                              ) : null}
                              {!ipLoadError && availableIps.length === 0 ? (
                                <p className="text-xs text-slate-500 dark:text-slate-500">
                                  No available IPs found.
                                </p>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                      {networkMode === 'host' ? (
                        <div className="space-y-2">
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            Choose a node allocation for the default IP and port.
                          </p>
                          <label className="block space-y-1">
                            <span className="text-slate-600 dark:text-slate-300">Primary allocation</span>
                            <div className="flex gap-2">
                              <select
                                className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400"
                                value={allocationId}
                                onChange={(event) => setAllocationId(event.target.value)}
                              >
                                <option value="">Select allocation</option>
                                {availableAllocations.map((allocation) => (
                                  <option key={allocation.id} value={allocation.id}>
                                    {allocation.ip}:{allocation.port}
                                    {allocation.alias ? ` (${allocation.alias})` : ''}
                                  </option>
                                ))}
                              </select>
                              <a
                                href={`/admin/nodes/${nodeId}/allocations`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 transition-all hover:border-primary-500 hover:text-primary-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-primary-500/50 dark:hover:text-primary-400"
                                title="Create allocations in a new tab — dropdown refreshes when you return"
                              >
                                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                                </svg>
                                New
                              </a>
                            </div>
                          </label>
                          {allocLoadError ? (
                            <p className="text-xs text-amber-600 dark:text-amber-300">{allocLoadError}</p>
                          ) : null}
                          {!allocLoadError && availableAllocations.length === 0 ? (
                            <p className="text-xs text-slate-500 dark:text-slate-500">
                              No available allocations found.{' '}
                              <a
                                href={`/admin/nodes/${nodeId}/allocations`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-primary-500 hover:underline"
                              >
                                Create one →
                              </a>
                            </p>
                          ) : null}
                        </div>
                      ) : null}
                    </>
                  ) : null}
                  {step === 'startup' ? (
                    <>
                      {templateVariables.length > 0 && (
                        <div className="space-y-3">
                          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                            Environment Variables
                          </h3>
                          {templateVariables.map((variable) => (
                            <label key={variable.name} className="block space-y-1">
                              <span className="text-slate-600 dark:text-slate-300">
                                {variable.name}
                                {variable.required && <span className="text-red-400 ml-1">*</span>}
                              </span>
                              {variable.description && (
                                <p className="text-xs text-slate-500 dark:text-slate-500">
                                  {variable.description}
                                </p>
                              )}
                              {variable.input === 'checkbox' ? (
                                <input
                                  type="checkbox"
                                  className="rounded border-slate-200 bg-white text-primary-600 focus:ring-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-primary-400"
                                  checked={environment[variable.name] === 'true' || environment[variable.name] === '1'}
                                  onChange={(e) => {
                                    const useNumeric = variable.default === '1' || variable.default === '0';
                                    setEnvironment((prev) => ({
                                      ...prev,
                                      [variable.name]: e.target.checked
                                        ? (useNumeric ? '1' : 'true')
                                        : (useNumeric ? '0' : 'false'),
                                    }));
                                  }}
                                />
                              ) : (
                                <input
                                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400"
                                  type={variable.input === 'number' ? 'number' : 'text'}
                                  value={environment[variable.name] || ''}
                                  onChange={(e) =>
                                    setEnvironment((prev) => ({
                                      ...prev,
                                      [variable.name]: e.target.value,
                                    }))
                                  }
                                  placeholder={variable.default}
                                />
                              )}
                            </label>
                          ))}
                        </div>
                      )}
                      {templateVariables.length === 0 ? (
                        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
                          No startup variables for this template.
                        </div>
                      ) : null}
                    </>
                  ) : null}
                </>
              </div>
            </div>

            {/* Footer */}
            <div className="border-t border-slate-200 bg-slate-50/50 px-8 py-5 dark:border-slate-800 dark:bg-slate-950/30">
              <div className="flex items-center justify-between gap-3">
              <button
                className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-600 transition-all duration-300 hover:border-rose-300 hover:bg-rose-50 hover:text-rose-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-rose-500/30 dark:hover:bg-rose-950/20 dark:hover:text-rose-400"
                onClick={() => setOpen(false)}
              >
                Cancel
              </button>
              <div className="flex items-center gap-3">
                {stepIndex > 0 ? (
                  <button
                    className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition-all duration-300 hover:border-primary-500 hover:bg-primary-50 hover:text-primary-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-primary-500/50 dark:hover:bg-primary-950/20 dark:hover:text-primary-400"
                    onClick={() => setStep(stepOrder[stepIndex - 1])}
                  >
                    Back
                  </button>
                ) : null}
                {stepIndex < stepOrder.length - 1 ? (
                  <button
                    className="rounded-lg bg-primary-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-primary-500/30 transition-all duration-300 hover:bg-primary-500 disabled:opacity-60"
                    onClick={() => setStep(stepOrder[stepIndex + 1])}
                    disabled={!canGoNext}
                  >
                    Next →
                  </button>
                ) : (
                  <button
                    className="rounded-lg bg-primary-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-primary-500/30 transition-all duration-300 hover:bg-primary-500 disabled:opacity-60"
                    onClick={() => mutation.mutate()}
                    disabled={disableSubmit}
                  >
                    {mutation.isPending ? 'Creating...' : 'Create Server'}
                  </button>
                )}
              </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

export default CreateServerModal;

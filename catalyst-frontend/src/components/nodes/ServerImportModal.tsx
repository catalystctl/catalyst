import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Loader2, Server, X } from 'lucide-react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { nodesApi } from '../../services/api/nodes';
import { templatesApi } from '../../services/api/templates';
import { adminApi } from '../../services/api/admin';
import { notifyError, notifySuccess } from '../../utils/notify';
import { ModalPortal } from '@/components/ui/modal-portal';
import { motion } from 'framer-motion';
import Combobox from '@/components/ui/combobox';

export interface UnregisteredContainer {
  containerId: string;
  image: string;
  status: string;
  labels: Record<string, string>;
  networkMode?: string;
  memoryLimitMb?: number;
  cpuCores?: number;
  discoveredAt: number;
}

interface ServerImportModalProps {
  open: boolean;
  onClose: () => void;
  nodeId: string;
  containers: UnregisteredContainer[];
}

export default function ServerImportModal({
  open,
  onClose,
  nodeId,
  containers,
}: ServerImportModalProps) {
  const queryClient = useQueryClient();
  const [importingId, setImportingId] = useState<string | null>(null);
  const [formState, setFormState] = useState<Record<string, {
    name: string;
    templateId: string;
    ownerId: string;
    allocatedMemoryMb: string;
    allocatedCpuCores: string;
    allocatedDiskMb: string;
    primaryPort: string;
  }>>({});

  // Fetch templates for dropdown
  const { data: templates = [] } = useQuery({
    queryKey: ['templates'],
    queryFn: () => templatesApi.list(),
    enabled: open,
  });

  // Fetch users for owner dropdown
  const { data: usersData } = useQuery({
    queryKey: ['admin-users'],
    queryFn: () => adminApi.listUsers(),
    enabled: open,
  });
  const users = usersData?.users ?? [];

  const templateOptions = templates.map((t: any) => ({
    value: t.id,
    label: t.name,
  }));

  const userOptions = users.map((u: any) => ({
    value: u.id,
    label: u.email || u.name || u.id,
  }));

  const importMutation = useMutation({
    mutationFn: async (containerId: string) => {
      const form = formState[containerId];
      if (!form?.name || !form?.templateId || !form?.ownerId) {
        throw new Error('Name, template, and owner are required');
      }
      return nodesApi.importServer(nodeId, {
        containerId,
        name: form.name,
        templateId: form.templateId,
        ownerId: form.ownerId,
        allocatedMemoryMb: form.allocatedMemoryMb ? Number(form.allocatedMemoryMb) : undefined,
        allocatedCpuCores: form.allocatedCpuCores ? Number(form.allocatedCpuCores) : undefined,
        allocatedDiskMb: form.allocatedDiskMb ? Number(form.allocatedDiskMb) : undefined,
        primaryPort: form.primaryPort ? Number(form.primaryPort) : undefined,
      });
    },
    onSuccess: () => {
      notifySuccess('Server imported successfully');
      queryClient.invalidateQueries({ queryKey: ['node', nodeId] });
      queryClient.invalidateQueries({ queryKey: ['node-stats', nodeId] });
      queryClient.invalidateQueries({ queryKey: ['unregistered-containers', nodeId] });
      setImportingId(null);
      setFormState((prev) => {
        const next = { ...prev };
        delete next[importingId!];
        return next;
      });
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || error?.message || 'Failed to import server';
      notifyError(message);
      setImportingId(null);
    },
  });

  if (!open) return null;

  const getForm = (containerId: string) => {
    const container = containers.find((c) => c.containerId === containerId);
    return (
      formState[containerId] ?? {
        name: '',
        templateId: '',
        ownerId: '',
        allocatedMemoryMb: container?.memoryLimitMb?.toString() ?? '',
        allocatedCpuCores: container?.cpuCores?.toString() ?? '',
        allocatedDiskMb: '10240',
        primaryPort: '25565',
      }
    );
  };

  const updateForm = (containerId: string, updates: Record<string, string>) => {
    setFormState((prev) => ({
      ...prev,
      [containerId]: { ...getForm(containerId), ...updates },
    }));
  };

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 px-4 backdrop-blur-sm">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
          className="w-full max-w-3xl rounded-xl border border-warning/30 bg-card shadow-xl"
        >
          <div className="flex items-center justify-between border-b border-warning/30 bg-warning/5 px-6 py-4">
            <div className="flex items-center gap-2">
              <Download className="h-5 w-5 text-warning" />
              <h2 className="text-lg font-semibold text-foreground">
                Import Discovered Servers
              </h2>
            </div>
            <button
              className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground dark:text-foreground"
              onClick={onClose}
            >
              Close
            </button>
          </div>

          <div className="max-h-[70vh] overflow-y-auto px-6 py-4">
            <div className="mb-4 text-sm text-muted-foreground">
              {containers.length} container(s) found on this node that are not registered as servers.
              Select a container and fill in the required details to import it.
            </div>

            {containers.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                No unregistered containers found.
              </div>
            ) : (
              <div className="space-y-3">
                {containers.map((container) => {
                  const isExpanded = importingId === container.containerId;
                  const form = getForm(container.containerId);

                  return (
                    <div
                      key={container.containerId}
                      className="rounded-lg border border-border/50 bg-surface-2/30 p-4"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <Server className="h-4 w-4 text-muted-foreground" />
                          <div>
                            <div className="text-sm font-mono font-medium text-foreground">
                              {container.containerId}
                            </div>
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              <span>{container.image || 'Unknown image'}</span>
                              <Badge
                                variant={
                                  container.status.includes('Up')
                                    ? 'success'
                                    : 'secondary'
                                }
                                className="text-[10px]"
                              >
                                {container.status.includes('Up') ? 'Running' : 'Stopped'}
                              </Badge>
                              {container.networkMode && (
                                <Badge
                                  variant={container.networkMode === 'host' ? 'warning' : 'outline'}
                                  className="text-[10px]"
                                >
                                  {container.networkMode === 'host' ? 'Host Network' : 'Bridge'}
                                </Badge>
                              )}
                            </div>
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant={isExpanded ? 'outline' : 'default'}
                          onClick={() =>
                            setImportingId(isExpanded ? null : container.containerId)
                          }
                          className="gap-1.5"
                        >
                          {isExpanded ? (
                            <>
                              <X className="h-3 w-3" />
                              Cancel
                            </>
                          ) : (
                            <>
                              <Download className="h-3 w-3" />
                              Import
                            </>
                          )}
                        </Button>
                      </div>

                      {isExpanded && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          className="mt-4 space-y-3 border-t border-border/50 pt-4"
                        >
                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <div>
                              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                                Server Name *
                              </label>
                              <input
                                type="text"
                                value={form.name}
                                onChange={(e) =>
                                  updateForm(container.containerId, { name: e.target.value })
                                }
                                placeholder="My Server"
                                className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
                              />
                            </div>
                            <div>
                              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                                Template *
                              </label>
                              <Combobox
                                options={templateOptions}
                                value={form.templateId}
                                onChange={(val: string) =>
                                  updateForm(container.containerId, { templateId: val })
                                }
                                placeholder="Select template..."
                              />
                            </div>
                            <div>
                              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                                Owner *
                              </label>
                              <Combobox
                                options={userOptions}
                                value={form.ownerId}
                                onChange={(val: string) =>
                                  updateForm(container.containerId, { ownerId: val })
                                }
                                placeholder="Select owner..."
                              />
                            </div>
                            <div>
                              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                                Primary Port
                              </label>
                              <input
                                type="number"
                                value={form.primaryPort}
                                onChange={(e) =>
                                  updateForm(container.containerId, { primaryPort: e.target.value })
                                }
                                className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
                              />
                            </div>
                            <div>
                              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                                Memory (MB)
                              </label>
                              <input
                                type="number"
                                value={form.allocatedMemoryMb}
                                onChange={(e) =>
                                  updateForm(container.containerId, {
                                    allocatedMemoryMb: e.target.value,
                                  })
                                }
                                placeholder="1024"
                                className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
                              />
                            </div>
                            <div>
                              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                                CPU Cores
                              </label>
                              <input
                                type="number"
                                value={form.allocatedCpuCores}
                                onChange={(e) =>
                                  updateForm(container.containerId, {
                                    allocatedCpuCores: e.target.value,
                                  })
                                }
                                placeholder="1"
                                className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
                              />
                            </div>
                          </div>

                          <div className="flex justify-end gap-2 pt-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setImportingId(null)}
                            >
                              Cancel
                            </Button>
                            <Button
                              size="sm"
                              onClick={() => importMutation.mutate(container.containerId)}
                              disabled={
                                !form.name || !form.templateId || !form.ownerId || importMutation.isPending
                              }
                              className="gap-1.5"
                            >
                              {importMutation.isPending ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <Download className="h-3 w-3" />
                              )}
                              Import Server
                            </Button>
                          </div>
                        </motion.div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </ModalPortal>
  );
}

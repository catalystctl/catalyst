import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { qk } from '@/lib/queryKeys';
import { queryClient } from '@/lib/queryClient';
import { MapPin, Plus, Pencil, Trash2, X } from 'lucide-react';
import { locationsApi, type Location } from '../../services/api/locations';
import { notifyError, notifySuccess } from '../../utils/notify';
import ConfirmDialog from '../shared/ConfirmDialog';
import { ModalPortal } from '@/components/ui/modal-portal';

// ── Location Form ──
function LocationForm({
  initial,
  onSave,
  onCancel,
  isPending,
}: {
  initial?: Location | null;
  onSave: (payload: { name: string; description?: string }) => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  const [name, setName] = useState(initial?.name || '');
  const [description, setDescription] = useState(initial?.description || '');

  const disableSubmit = !name.trim() || isPending;

  return (
    <div className="space-y-3">
      <label className="block space-y-1">
        <span className="text-xs font-medium text-muted-foreground">
          Name <span className="text-destructive">*</span>
        </span>
        <input
          className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground transition-all duration-300 focus:border-primary focus:outline-none hover:border-primary dark:border-border dark:bg-surface-1 dark:hover:border-primary/30"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="US-East"
          autoFocus
        />
      </label>
      <label className="block space-y-1">
        <span className="text-xs font-medium text-muted-foreground">Description (optional)</span>
        <textarea
          className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground transition-all duration-300 focus:border-primary focus:outline-none hover:border-primary dark:border-border dark:bg-surface-1 dark:hover:border-primary/30"
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Brief description of this location"
        />
      </label>
      <div className="flex justify-end gap-2 pt-1">
        <button
          className="rounded-full border border-border px-4 py-1.5 text-xs font-semibold text-muted-foreground transition-all duration-300 hover:border-primary hover:text-foreground dark:border-border dark:hover:border-primary/30"
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          className="rounded-full bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground shadow-lg shadow-primary-500/20 transition-all duration-300 hover:bg-primary/90 disabled:opacity-60"
          onClick={() =>
            onSave({
              name: name.trim(),
              description: description.trim() || undefined,
            })
          }
          disabled={disableSubmit}
        >
          {isPending ? 'Saving...' : initial ? 'Update' : 'Create'}
        </button>
      </div>
    </div>
  );
}

// ── Main Modal ──
type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export default function LocationsManagerModal({ open, onOpenChange }: Props) {
  const [editingLocation, setEditingLocation] = useState<Location | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Location | null>(null);

  const { data: locations = [], isLoading } = useQuery({
    queryKey: qk.locations(),
    queryFn: locationsApi.list,
    refetchInterval: 15000,
  });

  const createMutation = useMutation({
    mutationFn: locationsApi.create,
    onSuccess: () => {
      notifySuccess('Location created');
      Promise.all([
        queryClient.invalidateQueries({ queryKey: qk.locations() }),
        queryClient.invalidateQueries({ queryKey: qk.nodes() }),
        queryClient.invalidateQueries({ queryKey: ['admin-nodes'] }),
      ]);
      setIsCreating(false);
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || 'Failed to create location';
      notifyError(message);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...payload }: { id: string } & Parameters<typeof locationsApi.update>[1]) =>
      locationsApi.update(id, payload),
    onSuccess: () => {
      notifySuccess('Location updated');
      Promise.all([
        queryClient.invalidateQueries({ queryKey: qk.locations() }),
        queryClient.invalidateQueries({ queryKey: qk.nodes() }),
        queryClient.invalidateQueries({ queryKey: ['admin-nodes'] }),
      ]);
      setEditingLocation(null);
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || 'Failed to update location';
      notifyError(message);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: locationsApi.remove,
    onSuccess: () => {
      notifySuccess('Location deleted');
      Promise.all([
        queryClient.invalidateQueries({ queryKey: qk.locations() }),
        queryClient.invalidateQueries({ queryKey: qk.nodes() }),
        queryClient.invalidateQueries({ queryKey: ['admin-nodes'] }),
      ]);
      setDeleteTarget(null);
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || 'Failed to delete location';
      notifyError(message);
    },
  });

  const handleCreate = (payload: Parameters<typeof locationsApi.create>[0]) => {
    createMutation.mutate(payload);
  };

  const handleUpdate = (payload: Parameters<typeof locationsApi.update>[1]) => {
    if (!editingLocation) return;
    updateMutation.mutate({ id: editingLocation.id, ...payload });
  };

  if (!open) return null;

  const isFormActive = isCreating || !!editingLocation;

  return (
    <>
      <ModalPortal>
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 px-4 py-10 backdrop-blur-sm">
          <div className="flex w-full max-w-2xl max-h-[85vh] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl transition-all duration-300 dark:border-border dark:bg-surface-1">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border px-6 py-4 dark:border-border">
              <div className="flex items-center gap-3">
                <div className="relative">
                  <div className="absolute -inset-1 rounded-lg bg-gradient-to-r from-emerald-500 to-cyan-500 opacity-20 blur-sm" />
                  <MapPin className="relative h-5 w-5 text-success dark:text-success" />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-foreground">
                    Manage Locations
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    Organize nodes by physical or geographic location.
                  </p>
                </div>
              </div>
              <button
                className="rounded-full border border-border px-3 py-1 text-xs font-semibold text-muted-foreground transition-all duration-300 hover:border-primary dark:border-border dark:hover:border-primary/30"
                onClick={() => onOpenChange(false)}
              >
                Close
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-6 py-4">
              {/* Inline form */}
              {isFormActive && (
                <div className="mb-4 rounded-xl border border-primary/30 bg-primary/5 p-4 dark:bg-primary/10">
                  <div className="mb-3 flex items-center justify-between">
                    <span className="text-sm font-semibold text-foreground">
                      {editingLocation ? 'Edit location' : 'New location'}
                    </span>
                    <button
                      className="rounded-full p-1 text-muted-foreground transition-colors hover:text-foreground"
                      onClick={() => {
                        setIsCreating(false);
                        setEditingLocation(null);
                      }}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  <LocationForm
                    key={editingLocation?.id || '__new__'}
                    initial={editingLocation}
                    onSave={editingLocation ? handleUpdate : handleCreate}
                    onCancel={() => {
                      setIsCreating(false);
                      setEditingLocation(null);
                    }}
                    isPending={createMutation.isPending || updateMutation.isPending}
                  />
                </div>
              )}

              {/* Location list */}
              {isLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-3 rounded-lg border border-border px-4 py-3"
                    >
                      <div className="h-8 w-8 animate-pulse rounded-lg bg-surface-3" />
                      <div className="flex-1 space-y-1.5">
                        <div className="h-4 w-28 animate-pulse rounded bg-surface-3" />
                        <div className="h-3 w-48 animate-pulse rounded bg-surface-2" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : locations.length === 0 && !isCreating ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <MapPin className="mb-3 h-10 w-10 text-muted-foreground/40" />
                  <p className="text-sm font-medium text-muted-foreground">No locations yet</p>
                  <p className="mt-1 text-xs text-muted-foreground/70">
                    Create a location to group your nodes.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {locations.map((location) => (
                    <div
                      key={location.id}
                      className="group flex items-center gap-3 rounded-xl border border-border px-4 py-3 transition-colors hover:bg-surface-2/50 dark:border-border"
                    >
                      {/* Icon */}
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-success/10 dark:bg-success/30">
                        <MapPin className="h-4 w-4 text-success dark:text-success" />
                      </div>

                      {/* Info */}
                      <div className="min-w-0 flex-1">
                        <span className="font-medium text-foreground">
                          {location.name}
                        </span>
                        {location.description && (
                          <p className="mt-0.5 truncate text-xs text-muted-foreground">
                            {location.description}
                          </p>
                        )}
                        <span className="text-[11px] text-muted-foreground/70">
                          {location.nodeCount ?? 0} node
                          {(location.nodeCount ?? 0) !== 1 ? 's' : ''}
                        </span>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
                        <button
                          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
                          onClick={() => {
                            setEditingLocation(location);
                            setIsCreating(false);
                          }}
                          title="Edit"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          className="rounded-md p-1.5 text-destructive transition-colors hover:bg-destructive/5 hover:text-destructive dark:hover:bg-destructive/50/10"
                          onClick={() => setDeleteTarget(location)}
                          title="Delete"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Footer */}
            {!isFormActive && (
              <div className="flex items-center justify-between border-t border-border px-6 py-3 dark:border-border">
                <span className="text-xs text-muted-foreground">
                  {locations.length} location{locations.length !== 1 ? 's' : ''}
                </span>
                <button
                  className="flex items-center gap-1.5 rounded-full bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground shadow-lg shadow-primary-500/20 transition-all duration-300 hover:bg-primary/90"
                  onClick={() => {
                    setEditingLocation(null);
                    setIsCreating(true);
                  }}
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add location
                </button>
              </div>
            )}
          </div>
        </div>
      </ModalPortal>

      {/* Delete confirmation */}
      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete Location"
        message={
          <div className="space-y-2">
            <p>
              Delete location <span className="font-semibold">{deleteTarget?.name}</span>?
            </p>
            <p className="text-xs text-muted-foreground">
              Nodes in this location will also be deleted. This action cannot be undone.
            </p>
          </div>
        }
        confirmText="Delete"
        cancelText="Cancel"
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        onCancel={() => setDeleteTarget(null)}
        variant="danger"
        loading={deleteMutation.isPending}
      />
    </>
  );
}

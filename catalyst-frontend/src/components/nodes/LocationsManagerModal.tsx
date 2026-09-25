import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery } from '@/csync';
import { qk } from '@/lib/queryKeys';
import { queryClient } from '@/lib/queryClient';
import { MapPin, Plus, Pencil, Trash2, X } from 'lucide-react';
import { locationsApi, type Location } from '../../services/api/locations';
import { notifyError, notifySuccess } from '../../utils/notify';
import ConfirmDialog from '../shared/ConfirmDialog';
import { BracketLabel } from '../deck/primitives';
import { Button } from '@/components/ui/button';
import {
 Dialog,
 DialogBody,
 DialogContent,
 DialogDescription,
 DialogFooter,
 DialogHeader,
 DialogTitle,
} from '@/components/ui/dialog';

/**
 * Maps a `returnTo` identifier (sent by the opening modal) to the
 * custom event that re-opens that modal after a location is created.
 */
const RETURN_EVENT_MAP: Record<string, string> = {
 'node-create': 'catalyst:return-to-node-create',
 'node-update': 'catalyst:return-to-node-update',
};

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
 const { t } = useTranslation('nodes');
 const [name, setName] = useState(initial?.name || '');
 const [description, setDescription] = useState(initial?.description || '');

 const disableSubmit = !name.trim() || isPending;

 return (
 <div className="space-y-3">
 <label className="block space-y-1">
 <span className="type-overline">
 {t('locations.name')} <span className="text-danger">*</span>
 </span>
 <input
 className="w-full rounded-sm border border-border/60 bg-background/40 px-2.5 py-1.5 text-mini text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary/40"
 value={name}
 onChange={(e) => setName(e.target.value)}
 placeholder="US-East"
 autoFocus
 />
 </label>
 <label className="block space-y-1">
 <span className="type-overline">{t('locations.descriptionOptional')}</span>
 <textarea
 className="w-full rounded-sm border border-border/60 bg-background/40 px-2.5 py-1.5 text-mini text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary/40"
 rows={2}
 value={description}
 onChange={(e) => setDescription(e.target.value)}
 placeholder={t('locations.descriptionPlaceholder')}
 />
 </label>
 <div className="flex justify-end gap-2 pt-1">
 <button
 className="h-8 rounded-sm border border-border/60 px-3 text-mini font-medium text-muted-foreground transition-colors hover:border-border hover:text-foreground"
 onClick={onCancel}
 >
 {t('common:actions.cancel')}
 </button>
 <button
 className="h-8 rounded-sm bg-primary px-3 text-mini font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
 onClick={() =>
 onSave({
 name: name.trim(),
 description: description.trim() || undefined,
 })
 }
 disabled={disableSubmit}
 >
 {isPending ? t('locations.saving') : initial ? t('locations.update') : t('common:actions.create')}
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
  const { t } = useTranslation('nodes');
 const [editingLocation, setEditingLocation] = useState<Location | null>(null);
 const [isCreating, setIsCreating] = useState(false);
 const [deleteTarget, setDeleteTarget] = useState<Location | null>(null);
 const returnToRef = useRef<string | null>(null);

 const { data: locations = [], isLoading } = useQuery({
 queryKey: qk.locations(),
 queryFn: locationsApi.list,
 staleTime: 60_000,
 });

 // Listen for the `returnTo` field in the open-locations-modal event
 useEffect(() => {
 const handler = (e: Event) => {
 const detail = (e as CustomEvent).detail;
 returnToRef.current = detail?.returnTo ?? null;
 };
 window.addEventListener('catalyst:open-locations-modal', handler);
 return () => window.removeEventListener('catalyst:open-locations-modal', handler);
 }, []);

 const createMutation = useMutation({
 mutationFn: locationsApi.create,
 onSuccess: (created) => {
 notifySuccess(t('locations.created'));
 setIsCreating(false);
 // If opened from another modal, send the user back after creation
 if (returnToRef.current) {
 const returnEvent = RETURN_EVENT_MAP[returnToRef.current];
 returnToRef.current = null;
 onOpenChange(false);
 if (returnEvent) {
 const createdId = created?.id ?? null;
 requestAnimationFrame(() => {
 window.dispatchEvent(new CustomEvent(returnEvent, { detail: { createdId } }));
 });
 }
 }
 },
 onError: (error: unknown) => {
   notifyError(error, 'nodes:locations.createError');
 },
 onSettled: () => {
 Promise.all([
 queryClient.invalidateQueries({ queryKey: qk.locations() }),
 queryClient.invalidateQueries({ queryKey: qk.nodes() }),
 queryClient.invalidateQueries({ queryKey: qk.adminNodes() }),
 ]);
 },
 });

 const updateMutation = useMutation({
 mutationFn: ({ id, ...payload }: { id: string } & Parameters<typeof locationsApi.update>[1]) =>
 locationsApi.update(id, payload),
 onSuccess: () => {
 notifySuccess(t('locations.updated'));
 setEditingLocation(null);
 },
 onError: (error: unknown) => {
   notifyError(error, 'nodes:locations.updateError');
 },
 onSettled: () => {
 Promise.all([
 queryClient.invalidateQueries({ queryKey: qk.locations() }),
 queryClient.invalidateQueries({ queryKey: qk.nodes() }),
 queryClient.invalidateQueries({ queryKey: qk.adminNodes() }),
 ]);
 },
 });

 const deleteMutation = useMutation({
 mutationFn: locationsApi.remove,
 onSuccess: () => {
 notifySuccess(t('locations.deleted'));
 setDeleteTarget(null);
 },
 onError: (error: unknown) => {
   notifyError(error, 'nodes:locations.deleteError');
 },
 onSettled: () => {
 Promise.all([
 queryClient.invalidateQueries({ queryKey: qk.locations() }),
 queryClient.invalidateQueries({ queryKey: qk.nodes() }),
 queryClient.invalidateQueries({ queryKey: qk.adminNodes() }),
 ]);
 },
 });

 const handleCreate = (payload: Parameters<typeof locationsApi.create>[0]) => {
 createMutation.mutate(payload);
 };

 const handleUpdate = (payload: Parameters<typeof locationsApi.update>[1]) => {
 if (!editingLocation) return;
 updateMutation.mutate({ id: editingLocation.id, ...payload });
 };


 const isFormActive = isCreating || !!editingLocation;

 return (
 <>
 <Dialog open={open} onOpenChange={onOpenChange}>
 <DialogContent size="xl">
 <DialogHeader icon={<MapPin className="h-4 w-4" />} iconClassName="border-border/50 bg-surface-2 text-muted-foreground">
 <DialogTitle>{t('locations.title')}</DialogTitle>
 <DialogDescription>{t('locations.description')}</DialogDescription>
 </DialogHeader>
 <DialogBody>
 {/* Inline form */}
 {isFormActive && (
 <div className="mb-3 rounded-sm border border-border/50 bg-surface-1/40 p-3">
 <div className="mb-3 flex items-center justify-between">
 <BracketLabel>{editingLocation ? t('locations.edit') : t('locations.new')}</BracketLabel>
 <button
 className="flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
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
 <div className="divide-y divide-border/50">
 {Array.from({ length: 3 }).map((_, i) => (
 <div
 key={i}
 className="flex items-center gap-3 py-2.5"
 >
 <div className="flex-1 space-y-1.5">
 <div className="h-3.5 w-28 animate-pulse rounded-sm bg-surface-3" />
 <div className="h-3 w-48 animate-pulse rounded-sm bg-surface-3" />
 </div>
 </div>
 ))}
 </div>
 ) : locations.length === 0 && !isCreating ? (
 <div className="flex flex-col items-center justify-center py-12 text-center">
 <MapPin className="mb-2 h-4 w-4 text-muted-foreground" />
 <p className="type-meta">{t('locations.empty')}</p>
 <p className="type-overline mt-1">
 {t('locations.emptyHint')}
 </p>
 </div>
 ) : (
 <div className="divide-y divide-border/50">
 {locations.map((location) => (
 <div
 key={location.id}
 className="group flex items-center gap-3 py-2"
 >
 {/* Info */}
 <div className="min-w-0 flex-1">
 <span className="font-display text-data font-semibold tracking-tight text-foreground">
 {location.name}
 </span>
 {location.description && (
 <p className="type-meta mt-0.5 truncate">
 {location.description}
 </p>
 )}
 <span className="type-meta font-mono tabular-nums">
 {t('locations.nodeCount', { count: location.nodeCount ?? 0 })}
 </span>
 </div>

 {/* Actions */}
 <div className="flex items-center gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
 <button
 className="flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
 onClick={() => {
 setEditingLocation(location);
 setIsCreating(false);
 }}
 title={t('common:actions.edit')}
 >
 <Pencil className="h-3.5 w-3.5" />
 </button>
 <button
 className="flex h-7 w-7 items-center justify-center rounded-sm text-danger transition-colors hover:bg-danger/5 hover:text-danger"
 onClick={() => setDeleteTarget(location)}
 title={t('common:actions.delete')}
 >
 <Trash2 className="h-3.5 w-3.5" />
 </button>
 </div>
 </div>
 ))}
 </div>
 )}
 </DialogBody>
 {!isFormActive && (
 <DialogFooter className="sm:justify-between">
 <span className="text-micro text-muted-foreground">
 {t('locations.count', { count: locations.length })}
 </span>
 <Button
 size="sm"
 className="h-8 px-3 text-mini"
 onClick={() => {
 setEditingLocation(null);
 setIsCreating(true);
 }}
 >
 <Plus className="h-3.5 w-3.5" />
 {t('locations.add')}
 </Button>
 </DialogFooter>
 )}
 </DialogContent>
 </Dialog>

 {/* Delete confirmation */}
 <ConfirmDialog
 open={!!deleteTarget}
 title={t('locations.deleteTitle')}
 message={
 <div className="space-y-3">
 <p>{t('locations.deleteConfirm', { name: deleteTarget?.name })}</p>
 <p className="type-meta">
   {t('locations.deleteWarning')}
 </p>
 </div>
 }
 confirmText={t('common:actions.delete')}
 cancelText={t('common:actions.cancel')}
 onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
 onCancel={() => setDeleteTarget(null)}
 variant="danger"
 loading={deleteMutation.isPending}
 />
 </>
 );
}

// src/plugins/ticketing-plugin/components/modals/TagManagerModal.tsx
// Modal for managing ticket tags — create, edit, delete.

import { useState } from 'react';
import type { Tag } from '../../types';
import { TAG_COLORS } from '../../constants';
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  Input,
  cn,
  TEXT_MUTED,
  SURFACE_2,
  SURFACE_3,
  FONT_DISPLAY,
  BORDER_COLOR,
  Loader2,
  Plus,
  Trash2,
  Check,
  X,
} from '../../../plugin-ui';
import { Edit3 } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../../../plugin-ui';

// ── Types ──

interface TagManagerModalProps {
  open: boolean;
  onClose: () => void;
  tags: Tag[];
  onCreateTag: (data: { name: string; color: string }) => Promise<Tag>;
  onUpdateTag: (id: string, data: { name?: string; color?: string }) => Promise<Tag>;
  onDeleteTag: (id: string) => Promise<void>;
}

// ── Component ──

export function TagManagerModal({
  open,
  onClose,
  tags,
  onCreateTag,
  onUpdateTag,
  onDeleteTag,
}: TagManagerModalProps) {
  // Create form
  const [newTagName, setNewTagName] = useState('');
  const [newTagColor, setNewTagColor] = useState(TAG_COLORS[0]);
  const [isCreating, setIsCreating] = useState(false);

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState('');
  const [isUpdating, setIsUpdating] = useState(false);

  // Delete state
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // ── Create ──
  async function handleCreate() {
    if (!newTagName.trim()) return;
    setIsCreating(true);
    try {
      await onCreateTag({ name: newTagName.trim(), color: newTagColor });
      setNewTagName('');
      setNewTagColor(TAG_COLORS[0]);
    } catch {
      // Error handled by parent
    } finally {
      setIsCreating(false);
    }
  }

  // ── Edit ──
  function startEdit(tag: Tag) {
    setEditingId(tag.id);
    setEditName(tag.name);
    setEditColor(tag.color);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditName('');
    setEditColor('');
  }

  async function handleUpdate() {
    if (!editingId || !editName.trim()) return;
    setIsUpdating(true);
    try {
      await onUpdateTag(editingId, { name: editName.trim(), color: editColor });
      cancelEdit();
    } catch {
      // Error handled by parent
    } finally {
      setIsUpdating(false);
    }
  }

  // ── Delete ──
  async function handleConfirmDelete() {
    if (!deletingId) return;
    setIsDeleting(true);
    try {
      await onDeleteTag(deletingId);
      setDeletingId(null);
    } catch {
      // Error handled by parent
    } finally {
      setIsDeleting(false);
    }
  }

  // ── Color picker grid ──
  function ColorGrid({
    selected,
    onSelect,
  }: {
    selected: string;
    onSelect: (color: string) => void;
  }) {
    return (
      <div className="flex flex-wrap gap-1.5">
        {TAG_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            onClick={() => onSelect(color)}
            className={cn(
              'h-6 w-6 rounded-md border-2 transition-transform hover:scale-110',
              selected === color ? 'border-foreground scale-110' : 'border-transparent',
            )}
            style={{ backgroundColor: color }}
            title={color}
          />
        ))}
      </div>
    );
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className={FONT_DISPLAY}>Manage Tags</DialogTitle>
            <DialogDescription>
              Create, edit, and delete tags for organizing tickets.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* ── Add tag form ── */}
            <div className={cn('rounded-lg border p-4 space-y-3', BORDER_COLOR, SURFACE_2)}>
              <h3 className="text-xs font-semibold text-foreground uppercase tracking-wide">
                Add New Tag
              </h3>
              <div className="flex items-center gap-2">
                <Input
                  placeholder="Tag name"
                  value={newTagName}
                  onChange={(e) => setNewTagName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreate();
                  }}
                  className="h-8 text-xs flex-1"
                />
                <Button
                  size="sm"
                  onClick={handleCreate}
                  disabled={!newTagName.trim() || isCreating}
                  className="h-8"
                >
                  {isCreating ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Plus className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  Add
                </Button>
              </div>
              <ColorGrid selected={newTagColor} onSelect={setNewTagColor} />
            </div>

            {/* ── Tag list ── */}
            <div className="space-y-1">
              <h3 className="text-xs font-semibold text-foreground uppercase tracking-wide">
                Existing Tags ({tags.length})
              </h3>

              {tags.length === 0 ? (
                <div className={cn('text-center py-6 text-xs', TEXT_MUTED)}>
                  No tags created yet. Add your first tag above.
                </div>
              ) : (
                <div className="space-y-1">
                  {tags.map((tag) => (
                    <div
                      key={tag.id}
                      className={cn(
                        'flex items-center justify-between rounded-lg border px-3 py-2',
                        BORDER_COLOR,
                        editingId === tag.id ? SURFACE_3 : SURFACE_2,
                      )}
                    >
                      {editingId === tag.id ? (
                        // Inline edit mode
                        <div className="flex-1 space-y-2">
                          <div className="flex items-center gap-2">
                            <Input
                              value={editName}
                              onChange={(e) => setEditName(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleUpdate();
                                if (e.key === 'Escape') cancelEdit();
                              }}
                              className="h-7 text-xs flex-1"
                              autoFocus
                            />
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0"
                              onClick={handleUpdate}
                              disabled={!editName.trim() || isUpdating}
                            >
                              {isUpdating ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Check className="h-3.5 w-3.5 text-emerald-400" />
                              )}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0"
                              onClick={cancelEdit}
                            >
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                          <ColorGrid selected={editColor} onSelect={setEditColor} />
                        </div>
                      ) : (
                        // Display mode
                        <>
                          <div className="flex items-center gap-2.5">
                            <div
                              className="h-4 w-4 rounded flex-shrink-0"
                              style={{ backgroundColor: tag.color }}
                            />
                            <span className="text-xs font-medium text-foreground">
                              {tag.name}
                            </span>
                          </div>
                          <div className="flex items-center gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0"
                              onClick={() => startEdit(tag)}
                            >
                              <Edit3 className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0 text-red-400 hover:text-red-300"
                              onClick={() => setDeletingId(tag.id)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={onClose}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete confirmation ── */}
      <AlertDialog open={!!deletingId} onOpenChange={(isOpen) => !isOpen && setDeletingId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Tag</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this tag? This will remove it from all tickets that use it. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              disabled={isDeleting}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {isDeleting && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

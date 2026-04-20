// src/plugins/ticketing-plugin/components/BulkActions.tsx
// Bulk action toolbar that appears at the bottom when tickets are selected.

import { useState } from 'react';
import type { TicketStatus, TicketPriority, UserRef, Tag } from '../types';
import { STATUS_CONFIG, PRIORITY_CONFIG } from '../constants';
import {
  Button,
  cn,
  SURFACE_1,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  X,
  Check,
  Loader2,
  Trash2,
  AlertTriangle,
} from '../../plugin-ui';

// ── Types ──

interface BulkActionsProps {
  selectedIds: string[];
  onAction: (action: string, value: unknown) => void;
  onClearSelection: () => void;
  users: UserRef[];
  tags: Tag[];
  isLoading: boolean;
}

type BulkActionType = 'status' | 'priority' | 'assignee' | 'tags_add' | 'tags_remove' | 'delete';

const ACTION_OPTIONS: { value: BulkActionType; label: string; icon: React.ReactNode; destructive?: boolean }[] = [
  { value: 'status', label: 'Change Status', icon: null },
  { value: 'priority', label: 'Change Priority', icon: null },
  { value: 'assignee', label: 'Assign To', icon: null },
  { value: 'tags_add', label: 'Add Tags', icon: null },
  { value: 'tags_remove', label: 'Remove Tags', icon: null },
  { value: 'delete', label: 'Delete', icon: <Trash2 className="h-3.5 w-3.5" />, destructive: true },
];

// ── Component ──

export function BulkActions({
  selectedIds,
  onAction,
  onClearSelection,
  users,
  tags,
  isLoading,
}: BulkActionsProps) {
  const [selectedAction, setSelectedAction] = useState<BulkActionType | null>(null);
  const [statusValue, setStatusValue] = useState<TicketStatus>('open');
  const [priorityValue, setPriorityValue] = useState<TicketPriority>('medium');
  const [assigneeValue, setAssigneeValue] = useState<string>('unassigned');
  const [selectedTagIds, setSelectedTagIds] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);

  const count = selectedIds.length;

  function handleConfirm() {
    if (!selectedAction) return;

    switch (selectedAction) {
      case 'status':
        onAction('status', statusValue);
        break;
      case 'priority':
        onAction('priority', priorityValue);
        break;
      case 'assignee':
        onAction('assignee', assigneeValue === 'unassigned' ? null : assigneeValue);
        break;
      case 'tags_add':
        onAction('tags_add', Array.from(selectedTagIds));
        break;
      case 'tags_remove':
        onAction('tags_remove', Array.from(selectedTagIds));
        break;
      case 'delete':
        if (confirmDelete) {
          onAction('delete', null);
          setConfirmDelete(false);
        } else {
          setConfirmDelete(true);
          return;
        }
        break;
    }

    // Reset
    setSelectedAction(null);
    setSelectedTagIds(new Set());
    setConfirmDelete(false);
  }

  function handleCancel() {
    setSelectedAction(null);
    setSelectedTagIds(new Set());
    setConfirmDelete(false);
  }

  function toggleTagSelection(tagId: string) {
    setSelectedTagIds((prev) => {
      const next = new Set(prev);
      if (next.has(tagId)) next.delete(tagId);
      else next.add(tagId);
      return next;
    });
  }

  return (
    <div
      className={cn(
        'sticky bottom-0 left-0 right-0 z-10 border-t border-border bg-surface-1 shadow-lg',
        SURFACE_1,
      )}
    >
      <div className="mx-auto flex max-w-7xl items-center gap-4 px-6 py-3">
        {/* Selection count */}
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground">
            {count} ticket{count !== 1 ? 's' : ''} selected
          </span>
        </div>

        {/* Action select */}
        <Select
          value={selectedAction ?? '__none__'}
          onValueChange={(v: string) => {
            if (v === '__none__') {
              handleCancel();
            } else {
              setSelectedAction(v as BulkActionType);
              setConfirmDelete(false);
            }
          }}
        >
          <SelectTrigger className="h-8 w-44 text-xs">
            <SelectValue placeholder="Choose action..." />
          </SelectTrigger>
          <SelectContent>
            {ACTION_OPTIONS.map((opt) => (
              <SelectItem
                key={opt.value}
                value={opt.value}
                className={cn(
                  'text-xs',
                  opt.destructive && 'text-red-400 focus:text-red-400',
                )}
              >
                <span className="flex items-center gap-2">
                  {opt.icon}
                  {opt.label}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Action-specific controls */}
        {selectedAction && (
          <div className="flex items-center gap-2">
            {/* Status */}
            {selectedAction === 'status' && (
              <Select value={statusValue} onValueChange={(v: string) => setStatusValue(v as TicketStatus)}>
                <SelectTrigger className="h-8 w-36 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(STATUS_CONFIG) as TicketStatus[]).map((s) => (
                    <SelectItem key={s} value={s} className="text-xs">
                      {STATUS_CONFIG[s].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {/* Priority */}
            {selectedAction === 'priority' && (
              <Select value={priorityValue} onValueChange={(v: string) => setPriorityValue(v as TicketPriority)}>
                <SelectTrigger className="h-8 w-36 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(PRIORITY_CONFIG) as TicketPriority[]).map((p) => (
                    <SelectItem key={p} value={p} className="text-xs">
                      {PRIORITY_CONFIG[p].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {/* Assignee */}
            {selectedAction === 'assignee' && (
              <Select value={assigneeValue} onValueChange={(v: string) => setAssigneeValue(v)}>
                <SelectTrigger className="h-8 w-44 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unassigned" className="text-xs">Unassigned</SelectItem>
                  {users.map((u) => (
                    <SelectItem key={u.id} value={u.id} className="text-xs">
                      {u.name ?? u.username}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {/* Tags */}
            {(selectedAction === 'tags_add' || selectedAction === 'tags_remove') && (
              <div className="flex items-center gap-1.5 flex-wrap max-w-md">
                {tags.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => toggleTagSelection(t.id)}
                    className={cn(
                      'inline-flex items-center rounded-md border px-2 py-1 text-xs font-medium transition-colors',
                      selectedTagIds.has(t.id)
                        ? 'border-primary bg-primary/15 text-primary'
                        : 'border-border bg-transparent text-muted-foreground hover:bg-surface-2',
                    )}
                    style={selectedTagIds.has(t.id) ? { borderColor: t.color, color: t.color, backgroundColor: `${t.color}15` } : undefined}
                  >
                    {t.name}
                  </button>
                ))}
              </div>
            )}

            {/* Delete confirmation */}
            {selectedAction === 'delete' && confirmDelete && (
              <span className="text-xs text-red-400">
                <AlertTriangle className="mr-1 inline h-3.5 w-3.5" />
                Are you sure? Click again to confirm.
              </span>
            )}

            {/* Confirm button */}
            <Button
              size="sm"
              className="h-8 text-xs"
              onClick={handleConfirm}
              disabled={
                isLoading ||
                (selectedAction === 'delete' && !confirmDelete) ||
                ((selectedAction === 'tags_add' || selectedAction === 'tags_remove') && selectedTagIds.size === 0)
              }
              variant={selectedAction === 'delete' ? 'destructive' : 'default'}
            >
              {isLoading ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : selectedAction === 'delete' ? (
                <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              ) : (
                <Check className="mr-1.5 h-3.5 w-3.5" />
              )}
              {selectedAction === 'delete' ? (confirmDelete ? 'Confirm Delete' : 'Delete') : 'Apply'}
            </Button>

            <Button
              size="sm"
              variant="ghost"
              className="h-8 text-xs"
              onClick={handleCancel}
            >
              Cancel
            </Button>
          </div>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Clear selection */}
        <Button
          variant="ghost"
          size="sm"
          className="h-8 text-xs text-muted-foreground"
          onClick={onClearSelection}
        >
          <X className="mr-1 h-3.5 w-3.5" />
          Clear selection
        </Button>
      </div>
    </div>
  );
}

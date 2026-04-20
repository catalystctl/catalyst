// src/plugins/ticketing-plugin/components/modals/TemplateManagerModal.tsx
// Modal for managing ticket templates — create, edit, delete.

import { useState } from 'react';
import type { TicketTemplate, TicketPriority } from '../../types';
import { PRIORITY_CONFIG } from '../../constants';
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  Input,
  Textarea,
  Label,
  cn,
  TEXT_MUTED,
  SURFACE_2,
  FONT_DISPLAY,
  BORDER_COLOR,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  Badge,
  Switch,
  Loader2,
  Plus,
  Trash2,
  Check,
  X,
} from '../../../plugin-ui';
import { Edit3, FileText, Star } from 'lucide-react';
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

interface TemplateManagerModalProps {
  open: boolean;
  onClose: () => void;
  templates: TicketTemplate[];
  onCreateTemplate: (data: Omit<TicketTemplate, 'id' | 'createdAt'>) => Promise<TicketTemplate>;
  onUpdateTemplate: (id: string, data: Partial<Omit<TicketTemplate, 'id' | 'createdAt'>>) => Promise<TicketTemplate>;
  onDeleteTemplate: (id: string) => Promise<void>;
  categories: string[];
}

// ── Empty template form ──

function emptyForm(): Omit<TicketTemplate, 'id' | 'createdAt'> {
  return {
    name: '',
    description: '',
    category: '',
    priority: 'medium',
    titleTemplate: '',
    descriptionTemplate: '',
    tags: [],
    isDefault: false,
  };
}

// ── Component ──

export function TemplateManagerModal({
  open,
  onClose,
  templates,
  onCreateTemplate,
  onUpdateTemplate,
  onDeleteTemplate,
  categories,
}: TemplateManagerModalProps) {
  // Form state
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Omit<TicketTemplate, 'id' | 'createdAt'>>(emptyForm());
  const [isSaving, setIsSaving] = useState(false);

  // Delete state
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // ── Form handlers ──
  function openCreateForm() {
    setEditingId(null);
    setForm(emptyForm());
    setIsFormOpen(true);
  }

  function openEditForm(template: TicketTemplate) {
    setEditingId(template.id);
    setForm({
      name: template.name,
      description: template.description,
      category: template.category,
      priority: template.priority,
      titleTemplate: template.titleTemplate,
      descriptionTemplate: template.descriptionTemplate,
      tags: [...template.tags],
      isDefault: template.isDefault,
    });
    setIsFormOpen(true);
  }

  function updateForm(patch: Partial<Omit<TicketTemplate, 'id' | 'createdAt'>>) {
    setForm((prev) => ({ ...prev, ...patch }));
  }

  function cancelForm() {
    setIsFormOpen(false);
    setEditingId(null);
    setForm(emptyForm());
  }

  async function handleSave() {
    if (!form.name.trim()) return;
    setIsSaving(true);
    try {
      if (editingId) {
        await onUpdateTemplate(editingId, form);
      } else {
        await onCreateTemplate(form);
      }
      cancelForm();
    } catch {
      // Error handled by parent
    } finally {
      setIsSaving(false);
    }
  }

  // ── Delete ──
  async function handleConfirmDelete() {
    if (!deletingId) return;
    setIsDeleting(true);
    try {
      await onDeleteTemplate(deletingId);
      setDeletingId(null);
    } catch {
      // Error handled by parent
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className={FONT_DISPLAY}>Manage Templates</DialogTitle>
            <DialogDescription>
              Create and manage ticket templates to speed up ticket creation.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* ── Add template button ── */}
            {!isFormOpen && (
              <Button size="sm" variant="outline" onClick={openCreateForm} className="w-full">
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                Create Template
              </Button>
            )}

            {/* ── Template form ── */}
            {isFormOpen && (
              <div className={cn('rounded-lg border p-4 space-y-4', BORDER_COLOR, SURFACE_2)}>
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold text-foreground uppercase tracking-wide">
                    {editingId ? 'Edit Template' : 'New Template'}
                  </h3>
                  <Button size="sm" variant="ghost" onClick={cancelForm} className="h-6 w-6 p-0">
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>

                {/* Name + Priority row */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Name <span className="text-red-400">*</span></Label>
                    <Input
                      placeholder="Template name"
                      value={form.name}
                      onChange={(e) => updateForm({ name: e.target.value })}
                      className="h-8 text-xs"
                      autoFocus
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Priority</Label>
                    <Select value={form.priority} onValueChange={(v) => updateForm({ priority: v as TicketPriority })}>
                      <SelectTrigger className="h-8 text-xs">
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
                  </div>
                </div>

                {/* Description */}
                <div className="space-y-1">
                  <Label className="text-xs">Description</Label>
                  <Input
                    placeholder="Brief description of when to use this template"
                    value={form.description}
                    onChange={(e) => updateForm({ description: e.target.value })}
                    className="h-8 text-xs"
                  />
                </div>

                {/* Category */}
                <div className="space-y-1">
                  <Label className="text-xs">Category</Label>
                  <Select value={form.category} onValueChange={(v) => updateForm({ category: v })}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="Select category..." />
                    </SelectTrigger>
                    <SelectContent>
                      {categories.map((c) => (
                        <SelectItem key={c} value={c} className="text-xs">
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Title template */}
                <div className="space-y-1">
                  <Label className="text-xs">Title Template</Label>
                  <Input
                    placeholder="e.g. [Bug] {{summary}}"
                    value={form.titleTemplate}
                    onChange={(e) => updateForm({ titleTemplate: e.target.value })}
                    className="h-8 text-xs"
                  />
                  <span className={cn('text-[10px]', TEXT_MUTED)}>
                    Use {'{{variables}}'} for placeholders. Users will fill these in when creating a ticket.
                  </span>
                </div>

                {/* Description template */}
                <div className="space-y-1">
                  <Label className="text-xs">Description Template</Label>
                  <Textarea
                    placeholder="Default description for the ticket..."
                    value={form.descriptionTemplate}
                    onChange={(e) => updateForm({ descriptionTemplate: e.target.value })}
                    className="min-h-[80px] text-xs resize-none"
                  />
                </div>

                {/* Default toggle */}
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-xs">Set as default template</Label>
                    <p className={cn('text-[10px]', TEXT_MUTED)}>
                      This template will be pre-selected when creating new tickets.
                    </p>
                  </div>
                  <Switch
                    checked={form.isDefault}
                    onCheckedChange={(checked) => updateForm({ isDefault: checked })}
                  />
                </div>

                {/* Save / Cancel */}
                <div className="flex items-center gap-2 pt-2">
                  <Button
                    size="sm"
                    onClick={handleSave}
                    disabled={!form.name.trim() || isSaving}
                  >
                    {isSaving ? (
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Check className="mr-1.5 h-3.5 w-3.5" />
                    )}
                    {editingId ? 'Update' : 'Create'}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={cancelForm}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {/* ── Template list ── */}
            {!isFormOpen && (
              <div className="space-y-1">
                <h3 className="text-xs font-semibold text-foreground uppercase tracking-wide">
                  Templates ({templates.length})
                </h3>

                {templates.length === 0 ? (
                  <div className={cn('text-center py-6 text-xs', TEXT_MUTED)}>
                    No templates created yet. Create your first template to speed up ticket creation.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {templates.map((template) => (
                      <div
                        key={template.id}
                        className={cn(
                          'flex items-center justify-between rounded-lg border px-4 py-3',
                          BORDER_COLOR,
                          SURFACE_2,
                        )}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                            <span className="text-sm font-medium text-foreground truncate">
                              {template.name}
                            </span>
                            {template.isDefault && (
                              <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-400 px-1.5 py-0 text-[10px] flex-shrink-0">
                                <Star className="mr-0.5 h-2.5 w-2.5" />
                                Default
                              </Badge>
                            )}
                          </div>
                          {template.description && (
                            <p className={cn('mt-1 text-xs truncate', TEXT_MUTED)}>
                              {template.description}
                            </p>
                          )}
                          <div className="mt-1.5 flex items-center gap-2">
                            <Badge variant="outline" className="px-1.5 py-0 text-[10px] border-border">
                              {PRIORITY_CONFIG[template.priority].label}
                            </Badge>
                            {template.category && (
                              <Badge variant="outline" className="px-1.5 py-0 text-[10px] border-border">
                                {template.category}
                              </Badge>
                            )}
                            {template.tags.length > 0 && (
                              <span className={cn('text-[10px]', TEXT_MUTED)}>
                                {template.tags.length} tag{template.tags.length !== 1 ? 's' : ''}
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-1 ml-4">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0"
                            onClick={() => openEditForm(template)}
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0 text-red-400 hover:text-red-300"
                            onClick={() => setDeletingId(template.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
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
            <AlertDialogTitle>Delete Template</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this template? This action cannot be undone.
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

// src/plugins/ticketing-plugin/components/modals/CreateTicketModal.tsx
// Modal for creating a new ticket with optional template pre-fill.

import { useState, useEffect } from 'react';
import type {
  CreateTicketPayload,
  TicketPriority,
  UserRef,
  ServerRef,
  Tag,
  TicketTemplate,
  TicketingSettings,
} from '../../types';
import { PRIORITY_CONFIG, DEFAULT_SETTINGS } from '../../constants';
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
  Separator,
  Loader2,
  Eye,
  EyeOff,
} from '../../../plugin-ui';
import { FileText } from 'lucide-react';

// ── Types ──

interface CreateTicketModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: CreateTicketPayload) => void;
  users: UserRef[];
  servers: ServerRef[];
  tags: Tag[];
  templates: TicketTemplate[];
  categories: string[];
  settings: TicketingSettings | null;
  isLoading: boolean;
}

// ── Component ──

export function CreateTicketModal({
  open,
  onClose,
  onSubmit,
  users,
  servers,
  tags,
  templates,
  categories,
  settings,
  isLoading,
}: CreateTicketModalProps) {
  const effectiveSettings = settings ?? DEFAULT_SETTINGS;

  // Form state
  const [templateId, setTemplateId] = useState<string>('none');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<TicketPriority>(effectiveSettings.defaultPriority);
  const [category, setCategory] = useState(effectiveSettings.defaultCategory);
  const [assigneeId, setAssigneeId] = useState<string>('');
  const [serverId, setServerId] = useState<string>('');
  const [selectedTagIds, setSelectedTagIds] = useState<Set<string>>(new Set());
  const [showPreview, setShowPreview] = useState(false);

  // Errors
  const [errors, setErrors] = useState<Record<string, string>>({});

  // ── Template pre-fill ──
  useEffect(() => {
    if (templateId === 'none') return;
    const template = templates.find((t) => t.id === templateId);
    if (!template) return;

    setTitle(template.titleTemplate);
    setDescription(template.descriptionTemplate);
    setPriority(template.priority);
    if (template.category) setCategory(template.category);
    if (template.tags.length > 0) setSelectedTagIds(new Set(template.tags));
  }, [templateId, templates]);

  // ── Reset form ──
  function resetForm() {
    setTemplateId('none');
    setTitle('');
    setDescription('');
    setPriority(effectiveSettings.defaultPriority);
    setCategory(effectiveSettings.defaultCategory);
    setAssigneeId('');
    setServerId('');
    setSelectedTagIds(new Set());
    setShowPreview(false);
    setErrors({});
  }

  function handleClose() {
    resetForm();
    onClose();
  }

  // ── Validate ──
  function validate(): boolean {
    const newErrors: Record<string, string> = {};
    if (!title.trim()) newErrors.title = 'Title is required';
    if (!description.trim()) newErrors.description = 'Description is required';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  // ── Submit ──
  function handleSubmit() {
    if (!validate()) return;

    const payload: CreateTicketPayload = {
      title: title.trim(),
      description: description.trim(),
      priority,
      category,
      assigneeId: assigneeId && assigneeId !== '__none__' ? assigneeId : undefined,
      serverId: serverId && serverId !== '__none__' ? serverId : undefined,
      tags: selectedTagIds.size > 0 ? Array.from(selectedTagIds) : undefined,
      templateId: templateId !== 'none' ? templateId : undefined,
    };

    onSubmit(payload);
    resetForm();
  }

  // ── Tag toggle ──
  function toggleTag(tagId: string) {
    setSelectedTagIds((prev) => {
      const next = new Set(prev);
      if (next.has(tagId)) next.delete(tagId);
      else next.add(tagId);
      return next;
    });
  }

  // ── Animation variants ──
  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className={FONT_DISPLAY}>Create New Ticket</DialogTitle>
          <DialogDescription>
            Fill in the details below to create a new support ticket.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* ── Template selector ── */}
          {templates.length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Template</Label>
              <Select value={templateId} onValueChange={setTemplateId}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Choose a template..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none" className="text-xs">Blank ticket</SelectItem>
                  {templates.map((t) => (
                    <SelectItem key={t.id} value={t.id} className="text-xs">
                      <span className="flex items-center gap-2">
                        {t.isDefault && (
                          <Badge variant="outline" className="px-1 py-0 text-[9px]">Default</Badge>
                        )}
                        {t.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <Separator />

          {/* ── Title ── */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">
              Title <span className="text-red-400">*</span>
            </Label>
            <Input
              placeholder="Brief summary of the issue or request"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                if (errors.title) setErrors((prev) => ({ ...prev, title: '' }));
              }}
              className="text-sm"
              autoFocus
            />
            {errors.title && (
              <span className="text-xs text-red-400">{errors.title}</span>
            )}
          </div>

          {/* ── Description ── */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-medium">
                Description <span className="text-red-400">*</span>
              </Label>
              <button
                type="button"
                onClick={() => setShowPreview(!showPreview)}
                className={cn(
                  'inline-flex items-center gap-1 text-xs transition-colors',
                  TEXT_MUTED,
                  'hover:text-foreground',
                )}
              >
                {showPreview ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                {showPreview ? 'Edit' : 'Preview'}
              </button>
            </div>

            {showPreview ? (
              <div
                className={cn(
                  'min-h-[120px] rounded-lg border p-3 text-sm',
                  BORDER_COLOR,
                  SURFACE_2,
                )}
              >
                {description ? (
                  <div
                    className="prose prose-invert prose-sm max-w-none"
                    dangerouslySetInnerHTML={{
                      __html: description
                        .replace(/\n/g, '<br/>')
                        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
                        .replace(/\*(.+?)\*/g, '<em>$1</em>')
                        .replace(/`(.+?)`/g, '<code class="bg-surface-3 px-1 rounded text-xs">$1</code>'),
                    }}
                  />
                ) : (
                  <span className={cn('text-xs', TEXT_MUTED)}>Nothing to preview</span>
                )}
              </div>
            ) : (
              <>
                <Textarea
                  placeholder="Describe the issue in detail... (Markdown supported)"
                  value={description}
                  onChange={(e) => {
                    setDescription(e.target.value);
                    if (errors.description) setErrors((prev) => ({ ...prev, description: '' }));
                  }}
                  className="min-h-[120px] text-sm resize-none"
                />
                {errors.description && (
                  <span className="text-xs text-red-400">{errors.description}</span>
                )}
              </>
            )}
          </div>

          {/* ── Priority + Category row ── */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Priority</Label>
              <Select value={priority} onValueChange={(v) => setPriority(v as TicketPriority)}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(PRIORITY_CONFIG) as TicketPriority[]).map((p) => (
                    <SelectItem key={p} value={p} className="text-xs">
                      <span className="flex items-center gap-2">
                        <span className={cn('h-2 w-2 rounded-full', PRIORITY_CONFIG[p].dot)} />
                        {PRIORITY_CONFIG[p].label}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(categories.length > 0 ? categories : [effectiveSettings.defaultCategory]).map((c) => (
                    <SelectItem key={c} value={c} className="text-xs">
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* ── Assignee + Server row ── */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Assignee (optional)</Label>
              <Select value={assigneeId} onValueChange={setAssigneeId}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Unassigned" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__" className="text-xs">Unassigned</SelectItem>
                  {users.map((u) => (
                    <SelectItem key={u.id} value={u.id} className="text-xs">
                      {u.name ?? u.username}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Server (optional)</Label>
              <Select value={serverId} onValueChange={setServerId}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="No server" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__" className="text-xs">No server</SelectItem>
                  {servers.map((s) => (
                    <SelectItem key={s.id} value={s.id} className="text-xs">
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* ── Tags ── */}
          {tags.length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Tags</Label>
              <div className="flex flex-wrap gap-1.5">
                {tags.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => toggleTag(t.id)}
                    className={cn(
                      'inline-flex items-center rounded-md border px-2 py-1 text-xs font-medium transition-colors',
                      selectedTagIds.has(t.id)
                        ? 'border-primary bg-primary/15 text-primary'
                        : 'border-border bg-transparent text-muted-foreground hover:bg-surface-2',
                    )}
                    style={
                      selectedTagIds.has(t.id)
                        ? { borderColor: t.color, color: t.color, backgroundColor: `${t.color}15` }
                        : undefined
                    }
                  >
                    {t.name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 pt-2">
          <Button variant="ghost" onClick={handleClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isLoading || !title.trim() || !description.trim()}>
            {isLoading ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <FileText className="mr-1.5 h-3.5 w-3.5" />
            )}
            Create Ticket
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

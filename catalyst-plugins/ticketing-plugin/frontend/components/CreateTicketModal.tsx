import { useEffect, useState, type FormEvent } from 'react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Textarea,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Loader2,
  FONT_DISPLAY,
  cn,
} from '@/plugins/plugin-ui';
import { CATEGORIES, PRIORITIES, PRIORITY_CONFIG } from '../constants';
import type {
  CreateTicketPayload,
  TicketPriority,
  TicketTemplate,
  UserRef,
  ServerRef,
} from '../types';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: CreateTicketPayload) => Promise<void>;
  users: UserRef[];
  servers: ServerRef[];
  templates: TicketTemplate[];
  defaultServerId?: string;
  loading?: boolean;
}

export function CreateTicketModal({
  open,
  onOpenChange,
  onSubmit,
  users,
  servers,
  templates,
  defaultServerId,
  loading,
}: Props) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<TicketPriority>('medium');
  const [category, setCategory] = useState<string>('Support');
  const [assigneeId, setAssigneeId] = useState<string>('');
  const [serverId, setServerId] = useState<string>(defaultServerId || '');
  const [templateId, setTemplateId] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTitle('');
    setDescription('');
    setPriority('medium');
    setCategory('Support');
    setAssigneeId('');
    setServerId(defaultServerId || '');
    setTemplateId('');
    setError(null);
  }, [open, defaultServerId]);

  useEffect(() => {
    if (!templateId) return;
    const tpl = templates.find((t) => t.id === templateId);
    if (!tpl) return;
    if (tpl.titleTemplate) setTitle(tpl.titleTemplate);
    if (tpl.descriptionTemplate) setDescription(tpl.descriptionTemplate);
    if (tpl.priority) setPriority(tpl.priority);
    if (tpl.category) setCategory(tpl.category);
  }, [templateId, templates]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !description.trim()) {
      setError('Title and description are required');
      return;
    }
    setError(null);
    try {
      await onSubmit({
        title: title.trim(),
        description: description.trim(),
        priority,
        category,
        assigneeId: assigneeId || undefined,
        serverId: serverId || undefined,
        templateId: templateId || undefined,
      });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create ticket');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg gap-0 p-0">
        <DialogHeader className="space-y-1 border-b border-border px-5 py-4">
          <DialogTitle className={cn('text-base', FONT_DISPLAY)}>New ticket</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Capture the issue clearly — title for the queue, description for the assignee.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 px-5 py-4">
          {templates.length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-[0.06em] text-muted-foreground">
                Template
              </Label>
              <Select
                value={templateId || '__none__'}
                onValueChange={(v) => setTemplateId(v === '__none__' ? '' : v)}
              >
                <SelectTrigger className="h-9 bg-background">
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None</SelectItem>
                  {templates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="ticket-title" className="text-[11px] uppercase tracking-[0.06em] text-muted-foreground">
              Title
            </Label>
            <Input
              id="ticket-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Short summary operators will scan"
              className="h-9 bg-background"
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ticket-desc" className="text-[11px] uppercase tracking-[0.06em] text-muted-foreground">
              Description
            </Label>
            <Textarea
              id="ticket-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What happened? Steps to reproduce, expected vs actual…"
              rows={5}
              className="resize-none bg-background"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-[0.06em] text-muted-foreground">
                Priority
              </Label>
              <Select value={priority} onValueChange={(v) => setPriority(v as TicketPriority)}>
                <SelectTrigger className="h-9 bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITIES.map((p) => (
                    <SelectItem key={p} value={p}>
                      {PRIORITY_CONFIG[p].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-[0.06em] text-muted-foreground">
                Category
              </Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger className="h-9 bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-[0.06em] text-muted-foreground">
                Assignee
              </Label>
              <Select
                value={assigneeId || '__unassigned__'}
                onValueChange={(v) => setAssigneeId(v === '__unassigned__' ? '' : v)}
              >
                <SelectTrigger className="h-9 bg-background">
                  <SelectValue placeholder="Unassigned" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__unassigned__">Unassigned</SelectItem>
                  {users.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.name || u.username}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-[0.06em] text-muted-foreground">
                Server
              </Label>
              <Select
                value={serverId || '__none__'}
                onValueChange={(v) => setServerId(v === '__none__' ? '' : v)}
              >
                <SelectTrigger className="h-9 bg-background">
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None</SelectItem>
                  {servers.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {error && (
            <p className="rounded-md border border-danger/25 bg-danger/10 px-3 py-2 text-xs text-danger">
              {error}
            </p>
          )}

          <DialogFooter className="gap-2 border-t border-border px-0 pb-0 pt-4 sm:space-x-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  Creating…
                </>
              ) : (
                'Create ticket'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

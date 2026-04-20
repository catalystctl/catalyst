import React, { useState, useRef, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Plus,
  AlertCircle,
  Loader2,
  FileText,
  X,
  Paperclip,
  Upload,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { modalVariants, fadeInVariants } from '../../constants';
import { formatFileSize } from '../../constants';
import type { Category, TicketUser, Server, TicketTemplate, Tag } from '../../types';
import { FieldLabel } from '../shared/FieldLabel';
import { IconBox } from '../shared/IconBox';
import { MarkdownEditor } from '../shared/MarkdownRenderer';
import { PRIORITY_CONFIG, TAG_COLORS } from '../../constants';

// Re-export api functions locally
import * as apiClient from '../../api';

interface CreateTicketModalProps {
  open: boolean;
  onClose: () => void;
  categories: Category[];
  users: TicketUser[];
  servers: Server[];
  defaultServerId?: string;
  defaultUserId?: string;
  onCreated: (ticket: any) => void;
  templates?: TicketTemplate[];
  tags?: Tag[];
}

export function CreateTicketModal({
  open,
  onClose,
  categories,
  users,
  servers,
  defaultServerId,
  defaultUserId,
  onCreated,
  templates = [],
  tags = [],
}: CreateTicketModalProps) {
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('general');
  const [priority, setPriority] = useState('medium');
  const [serverId, setServerId] = useState(defaultServerId || '');
  const [userId, setUserId] = useState(defaultUserId || '');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [attachments, setAttachments] = useState<File[]>([]);
  const [tagSearch, setTagSearch] = useState('');
  const [showTagDropdown, setShowTagDropdown] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  const filteredTags = tags.filter(
    (t) =>
      t.name.toLowerCase().includes(tagSearch.toLowerCase()) &&
      !selectedTags.includes(t.id)
  );

  const handleSubmit = async () => {
    if (!subject.trim()) {
      setError('Subject is required');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const body: any = {
        subject: subject.trim(),
        description: description.trim(),
        category,
        priority,
      };
      if (serverId) body.serverId = serverId;
      if (userId) body.createdBy = userId;
      if (selectedTags.length > 0) body.tags = selectedTags;
      const res = await apiClient.createTicket(body);
      if (res.success) {
        // Upload attachments
        for (const file of attachments) {
          await apiClient.uploadAttachment(res.data.id, file);
        }
        resetForm();
        onCreated(res.data);
        onClose();
      } else {
        setError(res.error || 'Failed to create ticket');
      }
    } catch {
      setError('Network error');
    }
    setSaving(false);
  };

  const resetForm = () => {
    setSubject('');
    setDescription('');
    setCategory('general');
    setPriority('medium');
    setServerId(defaultServerId || '');
    setUserId(defaultUserId || '');
    setSelectedTags([]);
    setAttachments([]);
    setError('');
    setTagSearch('');
    setShowTemplates(false);
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    setAttachments((prev) => [...prev, ...files]);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const applyTemplate = (template: TicketTemplate) => {
    setSubject(template.subject || '');
    setDescription(template.body || '');
    setCategory(template.category || 'general');
    setPriority(template.priority || 'medium');
    setSelectedTags(template.tags || []);
    setShowTemplates(false);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <motion.div
        variants={fadeInVariants}
        initial="hidden"
        animate="visible"
        exit="exit"
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <motion.div
        variants={modalVariants}
        initial="hidden"
        animate="visible"
        exit="exit"
        className="relative z-10 w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl border border-border bg-card p-6 shadow-elevated dark:shadow-elevated-dark"
      >
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <IconBox color="primary">
              <Plus className="h-4 w-4 text-primary" />
            </IconBox>
            <div>
              <h2 className="font-display text-lg font-semibold text-foreground">Create Ticket</h2>
              <p className="text-xs text-muted-foreground">Describe your issue or request</p>
            </div>
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Template selector */}
        {templates.length > 0 && (
          <div className="mb-4">
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-xs"
              onClick={() => setShowTemplates(!showTemplates)}
            >
              <FileText className="h-3.5 w-3.5" />
              {showTemplates ? 'Hide Templates' : 'Use Template'}
            </Button>
            <AnimatePresence>
              {showTemplates && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden"
                >
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    {templates.map((template) => (
                      <button
                        key={template.id}
                        onClick={() => applyTemplate(template)}
                        className="flex items-start gap-2 rounded-lg border border-border p-3 text-left transition-colors hover:bg-surface-2"
                      >
                        <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                        <div>
                          <p className="text-sm font-medium text-foreground">{template.name}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">{template.description}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        <div className="space-y-4">
          {/* Subject */}
          <div>
            <FieldLabel>Subject *</FieldLabel>
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Brief summary of the issue"
              className="mt-1.5"
              autoFocus
            />
          </div>

          {/* Description with markdown */}
          <div>
            <FieldLabel>Description</FieldLabel>
            <MarkdownEditor
              value={description}
              onChange={setDescription}
              placeholder="Detailed description, steps to reproduce, expected behavior... (markdown supported)"
              rows={5}
              className="mt-1.5"
            />
          </div>

          {/* Category & Priority */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <FieldLabel>Category</FieldLabel>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="mt-1.5 flex h-9 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <FieldLabel>Priority</FieldLabel>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                className="mt-1.5 flex h-9 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                {Object.entries(PRIORITY_CONFIG).map(([k, v]) => (
                  <option key={k} value={k}>{v.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Server & User */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <FieldLabel>Link to Server</FieldLabel>
              <select
                value={serverId}
                onChange={(e) => setServerId(e.target.value)}
                className="mt-1.5 flex h-9 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                <option value="">None</option>
                {servers.map((s) => (
                  <option key={s.id} value={s.id}>{s.label || s.name || s.id}</option>
                ))}
              </select>
            </div>
            <div>
              <FieldLabel>On behalf of</FieldLabel>
              <select
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                className="mt-1.5 flex h-9 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                <option value="">Myself</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>{u.username || u.email}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Tags with autocomplete */}
          <div className="relative">
            <FieldLabel>Tags</FieldLabel>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 min-h-[36px]">
              {selectedTags.map((tagId) => {
                const tag = tags.find((t) => t.id === tagId);
                if (!tag) return null;
                return (
                  <Badge key={tagId} variant="secondary" className="gap-1 text-xs">
                    {tag.name}
                    <button
                      type="button"
                      onClick={() => setSelectedTags((prev) => prev.filter((t) => t !== tagId))}
                      className="ml-0.5 rounded-full p-0.5 hover:bg-surface-3"
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </Badge>
                );
              })}
              <input
                value={tagSearch}
                onChange={(e) => {
                  setTagSearch(e.target.value);
                  setShowTagDropdown(true);
                }}
                onFocus={() => setShowTagDropdown(true)}
                onBlur={() => setTimeout(() => setShowTagDropdown(false), 200)}
                placeholder={selectedTags.length === 0 ? 'Add tags...' : ''}
                className="min-w-[100px] flex-1 border-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground/50"
              />
            </div>
            {/* Tag dropdown */}
            {showTagDropdown && filteredTags.length > 0 && (
              <div className="absolute left-0 right-0 top-full z-10 mt-1 max-h-40 overflow-y-auto rounded-lg border border-border bg-card shadow-lg">
                {filteredTags.map((tag) => (
                  <button
                    key={tag.id}
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setSelectedTags((prev) => [...prev, tag.id]);
                      setTagSearch('');
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-surface-2"
                  >
                    <span className={cn('h-2.5 w-2.5 rounded-full', TAG_COLORS.find((c) => c.name.toLowerCase() === tag.color?.toLowerCase())?.dot || 'bg-gray-500')} />
                    {tag.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Attachments */}
          <div>
            <FieldLabel>Attachments</FieldLabel>
            <div
              ref={dropRef}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              className="mt-1.5 rounded-lg border border-dashed border-border p-4 text-center transition-colors hover:border-primary/40 hover:bg-surface-2/50"
            >
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  const files = Array.from(e.target.files || []);
                  setAttachments((prev) => [...prev, ...files]);
                  e.target.value = '';
                }}
              />
              <Upload className="mx-auto h-6 w-6 text-muted-foreground/50" />
              <p className="mt-1 text-xs text-muted-foreground">
                Drag and drop files here, or{' '}
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="text-primary hover:underline"
                >
                  browse
                </button>
              </p>
            </div>
            {attachments.length > 0 && (
              <div className="mt-2 space-y-1.5">
                {attachments.map((file, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 rounded-lg border border-border/50 bg-surface-2/50 px-3 py-1.5"
                  >
                    <Paperclip className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="flex-1 truncate text-xs text-foreground">{file.name}</span>
                    <span className="text-xs text-muted-foreground">{formatFileSize(file.size)}</span>
                    <button
                      type="button"
                      onClick={() => removeAttachment(i)}
                      className="rounded p-0.5 text-muted-foreground hover:text-danger"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="mt-6 flex items-center justify-end gap-2 border-t border-border pt-4">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Create Ticket
          </Button>
        </div>
      </motion.div>
    </div>
  );
}

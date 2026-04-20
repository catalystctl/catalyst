import React, { useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, X, FileText, Plus, Trash2 } from 'lucide-react';
import { motion } from 'framer-motion';
import { modalVariants, fadeInVariants, PRIORITY_CONFIG } from '../../constants';
import type { TicketTemplate } from '../../types';
import { FieldLabel } from '../shared/FieldLabel';
import { IconBox } from '../shared/IconBox';

interface TemplateManagerModalProps {
  open: boolean;
  onClose: () => void;
  templates: TicketTemplate[];
  categories: { id: string; name: string }[];
  onCreated: (data: Record<string, any>) => Promise<void>;
  onDeleted: (id: string) => Promise<void>;
}

export function TemplateManagerModal({
  open,
  onClose,
  templates,
  categories,
  onCreated,
  onDeleted,
}: TemplateManagerModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [category, setCategory] = useState('general');
  const [priority, setPriority] = useState('medium');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleCreate = async () => {
    if (!name.trim() || !subject.trim()) {
      setError('Name and subject are required');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await onCreated({ name: name.trim(), description: description.trim(), subject: subject.trim(), body: body.trim(), category, priority });
      setName('');
      setDescription('');
      setSubject('');
      setBody('');
      setCategory('general');
      setPriority('medium');
    } catch {
      setError('Failed to create template');
    }
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this template?')) return;
    try {
      await onDeleted(id);
    } catch {
      // silent
    }
  };

  const handleClose = () => {
    setName('');
    setDescription('');
    setSubject('');
    setBody('');
    setError('');
    onClose();
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
        onClick={handleClose}
      />
      <motion.div
        variants={modalVariants}
        initial="hidden"
        animate="visible"
        exit="exit"
        className="relative z-10 w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl border border-border bg-card p-6 shadow-elevated dark:shadow-elevated-dark"
      >
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <IconBox color="info">
              <FileText className="h-4 w-4 text-info" />
            </IconBox>
            <div>
              <h2 className="font-display text-lg font-semibold text-foreground">Ticket Templates</h2>
              <p className="text-xs text-muted-foreground">Pre-defined templates for common ticket types</p>
            </div>
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Create form */}
        <div className="mb-4 space-y-3 rounded-lg border border-border p-4">
          <FieldLabel>Create New Template</FieldLabel>
          {error && <p className="text-xs text-danger">{error}</p>}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <FieldLabel>Name *</FieldLabel>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Template name" className="mt-1 h-8 text-sm" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <FieldLabel>Category</FieldLabel>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="mt-1 h-8 w-full rounded-lg border border-border bg-background px-2 text-xs"
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
                  className="mt-1 h-8 w-full rounded-lg border border-border bg-background px-2 text-xs"
                >
                  {Object.entries(PRIORITY_CONFIG).map(([k, v]) => (
                    <option key={k} value={k}>{v.label}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
          <div>
            <FieldLabel>Description</FieldLabel>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Brief description" className="mt-1 h-8 text-sm" />
          </div>
          <div>
            <FieldLabel>Subject *</FieldLabel>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Pre-filled subject" className="mt-1 h-8 text-sm" />
          </div>
          <div>
            <FieldLabel>Body</FieldLabel>
            <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Pre-filled description (markdown supported)" rows={3} className="mt-1 text-sm" />
          </div>
          <Button size="sm" onClick={handleCreate} disabled={saving} className="gap-1">
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
            Create Template
          </Button>
        </div>

        {/* Existing templates */}
        <div className="max-h-64 space-y-2 overflow-y-auto">
          {templates.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">No templates yet</p>
          ) : (
            templates.map((template) => (
              <div key={template.id} className="flex items-start gap-3 rounded-lg border border-border p-3">
                <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">{template.name}</p>
                  {template.description && (
                    <p className="mt-0.5 text-xs text-muted-foreground">{template.description}</p>
                  )}
                  <p className="mt-1 text-xs text-muted-foreground">
                    {template.subject} · {PRIORITY_CONFIG[template.priority]?.label || template.priority}
                  </p>
                </div>
                <button
                  onClick={() => handleDelete(template.id)}
                  className="shrink-0 rounded p-1 text-muted-foreground hover:bg-danger/10 hover:text-danger transition-colors"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))
          )}
        </div>

        <div className="mt-4 flex justify-end border-t border-border pt-3">
          <Button variant="ghost" onClick={handleClose}>Close</Button>
        </div>
      </motion.div>
    </div>
  );
}

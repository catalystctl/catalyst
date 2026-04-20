import React, { useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, X, Tag, Plus, Trash2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { modalVariants, fadeInVariants, TAG_COLORS } from '../../constants';
import type { Tag as TagType } from '../../types';
import { FieldLabel } from '../shared/FieldLabel';
import { IconBox } from '../shared/IconBox';
import { TagBadge } from '../shared/TagBadge';

interface TagManagerModalProps {
  open: boolean;
  onClose: () => void;
  tags: TagType[];
  onCreated: (name: string, color: string) => Promise<void>;
  onDeleted: (id: string) => Promise<void>;
}

export function TagManagerModal({ open, onClose, tags, onCreated, onDeleted }: TagManagerModalProps) {
  const [name, setName] = useState('');
  const [color, setColor] = useState(TAG_COLORS[0].name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleCreate = async () => {
    if (!name.trim()) { setError('Name is required'); return; }
    if (tags.some((t) => t.name.toLowerCase() === name.trim().toLowerCase())) {
      setError('Tag already exists');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await onCreated(name.trim(), color);
      setName('');
    } catch {
      setError('Failed to create tag');
    }
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this tag? It will be removed from all tickets.')) return;
    try {
      await onDeleted(id);
    } catch {
      // silent
    }
  };

  const handleClose = () => {
    setName('');
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
        className="relative z-10 w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-elevated dark:shadow-elevated-dark"
      >
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <IconBox color="violet">
              <Tag className="h-4 w-4 text-violet-600 dark:text-violet-400" />
            </IconBox>
            <div>
              <h2 className="font-display text-lg font-semibold text-foreground">Manage Tags</h2>
              <p className="text-xs text-muted-foreground">Create and manage ticket labels</p>
            </div>
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Create tag */}
        <div className="mb-4 space-y-3 rounded-lg border border-border p-3">
          <FieldLabel>Create New Tag</FieldLabel>
          {error && (
            <p className="text-xs text-danger">{error}</p>
          )}
          <div className="flex gap-2">
            <Input
              value={name}
              onChange={(e) => { setName(e.target.value); setError(''); }}
              placeholder="Tag name"
              className="h-8 text-sm"
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            />
            <Button size="sm" onClick={handleCreate} disabled={saving} className="gap-1">
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
              Add
            </Button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {TAG_COLORS.map((c) => (
              <button
                key={c.name}
                type="button"
                onClick={() => setColor(c.name)}
                className={cn(
                  'flex h-6 w-6 items-center justify-center rounded-full border-2 transition-all',
                  c.dot,
                  color === c.name
                    ? 'border-foreground scale-110'
                    : 'border-transparent hover:scale-105'
                )}
                title={c.name}
              />
            ))}
          </div>
        </div>

        {/* Tag list */}
        <div className="max-h-64 space-y-1.5 overflow-y-auto">
          {tags.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">No tags yet</p>
          ) : (
            tags.map((tag) => (
              <div key={tag.id} className="flex items-center gap-2">
                <TagBadge tag={tag} size="md" />
                <button
                  onClick={() => handleDelete(tag.id)}
                  className="ml-auto rounded p-1 text-muted-foreground hover:bg-danger/10 hover:text-danger transition-colors"
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

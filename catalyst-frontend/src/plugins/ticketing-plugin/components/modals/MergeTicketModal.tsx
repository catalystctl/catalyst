import React, { useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, GitMerge, X, AlertCircle, CheckCircle2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { modalVariants, fadeInVariants, timeAgo } from '../../constants';
import type { Ticket } from '../../types';
import { FieldLabel } from '../shared/FieldLabel';
import { IconBox } from '../shared/IconBox';
import { StatusBadge } from '../shared/StatusBadge';
import { PriorityDot } from '../shared/PriorityDot';

interface MergeTicketModalProps {
  open: boolean;
  onClose: () => void;
  tickets: Ticket[];
  onMerged: (primaryId: string, sourceIds: string[]) => void;
}

export function MergeTicketModal({ open, onClose, tickets, onMerged }: MergeTicketModalProps) {
  const [primaryId, setPrimaryId] = useState('');
  const [merging, setMerging] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const sourceIds = tickets.filter((t) => t.id !== primaryId).map((t) => t.id);

  const handleMerge = async () => {
    if (!primaryId || sourceIds.length === 0) {
      setError('Select a primary ticket and at least one source');
      return;
    }
    setMerging(true);
    setError('');
    try {
      onMerged(primaryId, sourceIds);
      setDone(true);
    } catch {
      setError('Failed to merge tickets');
    }
    setMerging(false);
  };

  const handleClose = () => {
    setPrimaryId('');
    setError('');
    setDone(false);
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
        className="relative z-10 w-full max-w-lg rounded-xl border border-border bg-card p-6 shadow-elevated dark:shadow-elevated-dark"
      >
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <IconBox color="warning">
              <GitMerge className="h-4 w-4 text-warning" />
            </IconBox>
            <div>
              <h2 className="font-display text-lg font-semibold text-foreground">Merge Tickets</h2>
              <p className="text-xs text-muted-foreground">
                Combine {tickets.length} tickets into one
              </p>
            </div>
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {done ? (
          <div className="py-6 text-center">
            <CheckCircle2 className="mx-auto h-10 w-10 text-success" />
            <p className="mt-3 text-sm font-medium text-foreground">Tickets merged successfully</p>
            <Button className="mt-4" onClick={handleClose}>
              Done
            </Button>
          </div>
        ) : (
          <>
            {error && (
              <div className="mb-4 flex items-center gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {error}
              </div>
            )}

            <div className="space-y-3">
              <FieldLabel>Select primary ticket (this ticket will be kept)</FieldLabel>
              <div className="max-h-64 space-y-2 overflow-y-auto">
                {tickets.map((ticket) => (
                  <button
                    key={ticket.id}
                    onClick={() => setPrimaryId(ticket.id)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors',
                      primaryId === ticket.id
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:bg-surface-2'
                    )}
                  >
                    <div className="flex h-5 w-5 items-center justify-center rounded-full border-2 border-border">
                      {primaryId === ticket.id && (
                        <div className="h-2.5 w-2.5 rounded-full bg-primary" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">{ticket.subject}</p>
                      <p className="text-xs text-muted-foreground">#{ticket.id.slice(0, 8)} · {timeAgo(ticket.createdAt)}</p>
                    </div>
                    <StatusBadge status={ticket.status} />
                    <PriorityDot priority={ticket.priority} />
                  </button>
                ))}
              </div>

              {primaryId && sourceIds.length > 0 && (
                <div className="rounded-lg border border-warning/30 bg-warning/5 p-3 text-xs text-muted-foreground">
                  <p>
                    <span className="font-semibold text-warning">Source tickets ({sourceIds.length}):</span> Their comments will be consolidated into the primary ticket.
                    The source tickets will be marked as merged.
                  </p>
                </div>
              )}
            </div>

            <div className="mt-6 flex items-center justify-end gap-2 border-t border-border pt-4">
              <Button variant="ghost" onClick={handleClose}>Cancel</Button>
              <Button
                onClick={handleMerge}
                disabled={merging || !primaryId || sourceIds.length === 0}
              >
                {merging ? <Loader2 className="h-4 w-4 animate-spin" /> : <GitMerge className="h-4 w-4" />}
                Merge Tickets
              </Button>
            </div>
          </>
        )}
      </motion.div>
    </div>
  );
}

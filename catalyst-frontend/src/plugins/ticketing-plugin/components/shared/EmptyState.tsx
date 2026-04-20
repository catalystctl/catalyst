import React from 'react';
import { motion } from 'framer-motion';
import { Ticket, Inbox, Search, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { itemVariants } from '../../constants';

interface EmptyStateProps {
  type: 'no-tickets' | 'no-results' | 'no-activity';
  title?: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({ type, title, description, actionLabel, onAction }: EmptyStateProps) {
  const defaults = {
    'no-tickets': {
      icon: Ticket,
      title: title || 'No tickets yet',
      description: description || 'Create your first ticket to get started',
      actionLabel: actionLabel || 'Create Ticket',
    },
    'no-results': {
      icon: Search,
      title: title || 'No matching tickets',
      description: description || 'Try adjusting your filters or search terms',
      actionLabel: actionLabel,
    },
    'no-activity': {
      icon: Inbox,
      title: title || 'No activity yet',
      description: description || 'Activity will appear here as changes are made',
      actionLabel: actionLabel,
    },
  };

  const config = defaults[type];
  const Icon = config.icon;

  return (
    <motion.div
      variants={itemVariants}
      className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card px-6 py-16 text-center"
    >
      {/* Gradient background blob */}
      <div className="relative inline-flex">
        <div className="absolute inset-0 -m-3 rounded-full bg-gradient-to-br from-zinc-100 to-zinc-200 blur-xl dark:from-zinc-800 dark:to-zinc-700" />
        <div className="relative flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-zinc-50 to-zinc-100 shadow-sm dark:from-zinc-900 dark:to-zinc-800">
          <Icon className="h-7 w-7 text-muted-foreground" />
        </div>
      </div>
      <h3 className="mt-4 font-display text-lg font-semibold text-foreground">{config.title}</h3>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">{config.description}</p>
      {config.actionLabel && onAction && (
        <Button className="mt-4 gap-2" onClick={onAction}>
          <Plus className="h-4 w-4" />
          {config.actionLabel}
        </Button>
      )}
    </motion.div>
  );
}

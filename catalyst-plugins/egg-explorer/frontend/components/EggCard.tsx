import React from 'react';
import { motion } from 'framer-motion';
import { Settings, ChevronRight } from 'lucide-react';
import { Badge } from '@/plugins/plugin-ui';
import { IMAGE_FAMILIES } from '../constants';
import type { EggSummary } from '../types';

interface Props {
  egg: EggSummary;
  onClick: () => void;
  index: number;
}

export function EggCard({ egg, onClick, index }: Props) {
  const fam = IMAGE_FAMILIES[egg.imageFamily] || IMAGE_FAMILIES.other;

  return (
    <motion.button
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        type: 'spring',
        stiffness: 260,
        damping: 22,
        delay: Math.min(index * 0.025, 0.4),
      }}
      whileHover={{ y: -2 }}
      onClick={onClick}
      className="group relative flex flex-col overflow-hidden rounded-xl border border-border bg-card text-left transition-colors duration-200 hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5 focus:outline-none focus:ring-2 focus:ring-primary/40"
    >
      <div className={`h-1 w-full ${fam.bg}`} />

      <div className="flex flex-1 flex-col p-4 gap-2">
        <div className="flex items-start justify-between gap-2">
          <h3 className="truncate text-sm font-semibold text-foreground transition-colors group-hover:text-primary dark:text-zinc-100 dark:group-hover:text-primary-400">
            {egg.name}
          </h3>
          <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
        </div>

        <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
          {egg.description || 'Click to view details'}
        </p>

        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
            {egg.categoryName}
          </Badge>
          <Badge className={`gap-1 border-transparent text-[10px] px-1.5 py-0 ${fam.bg} ${fam.color}`}>
            <span>{fam.icon}</span>
            {fam.label}
          </Badge>
          {egg.enriched && egg.variableCount > 0 && (
            <Badge variant="outline" className="gap-1 text-[10px] px-1.5 py-0">
              <Settings className="h-2.5 w-2.5" />
              {egg.variableCount}
            </Badge>
          )}
        </div>

        <div className="mt-auto border-t border-border/40 pt-2">
          <span className="text-[11px] text-muted-foreground">
            by <span className="font-medium text-foreground/70">{egg.author}</span>
          </span>
        </div>
      </div>
    </motion.button>
  );
}

export function EggCardSkeleton() {
  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-border bg-card">
      <div className="h-1 animate-pulse bg-muted" />
      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
        <div className="h-3 w-full animate-pulse rounded bg-muted" />
        <div className="h-3 w-4/5 animate-pulse rounded bg-muted" />
        <div className="mt-1 flex gap-1.5">
          <div className="h-5 w-14 animate-pulse rounded-md bg-muted" />
          <div className="h-5 w-12 animate-pulse rounded-md bg-muted" />
        </div>
        <div className="mt-auto border-t border-border/40 pt-2">
          <div className="h-3 w-20 animate-pulse rounded bg-muted" />
        </div>
      </div>
    </div>
  );
}

// src/plugins/egg-explorer/components/EggDetailModal.tsx

import React, { useState, useEffect } from 'react';
import { reportSystemError } from '../../../services/api/systemErrors';
import {
  X,
  Download,
  Loader2,
  Check,
  AlertCircle,
  Terminal,
  Settings,
  Image as ImageIcon,
  Shield,
  FileCode,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../../../components/ui/dialog';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { ScrollArea } from '../../../components/ui/scroll-area';
import { Skeleton } from '../../../components/ui/skeleton';
import { IMAGE_FAMILIES } from '../constants';
import { fetchFullEgg, importEgg, fetchNests } from '../api';
import type { EggSummary } from '../types';

interface Props {
  egg: EggSummary | null;
  open: boolean;
  onClose: () => void;
}

export function EggDetailModal({ egg, open, onClose }: Props) {
  const [installing, setInstalling] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nests, setNests] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedNestId, setSelectedNestId] = useState('');
  const [showScript, setShowScript] = useState(false);

  // Reset state when egg changes
  useEffect(() => {
    setInstalled(false);
    setError(null);
    setInstalling(false);
    setShowScript(false);
    setSelectedNestId('');
  }, [egg?.id]);

  // Fetch nests on open
  useEffect(() => {
    if (open) {
      fetchNests()
        .then(setNests)
        .catch(() => {});
    }
  }, [open]);

  if (!egg) return null;

  const fam = IMAGE_FAMILIES[egg.imageFamily] || IMAGE_FAMILIES.other;

  const handleInstall = async () => {
    setInstalling(true);
    setError(null);

    try {
      const fullEgg = await fetchFullEgg(egg.id);
      await importEgg(fullEgg, selectedNestId || undefined);
      setInstalled(true);
    } catch (err: any) {
      reportSystemError({
        level: 'error',
        component: 'EggDetailModal',
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
        metadata: { context: 'Egg installation failed' },
      });
      setError(err?.message || 'Installation failed');
    } finally {
      setInstalling(false);
    }
  };

  const installImage = egg.installImage || egg.images[0] || 'N/A';
  const displayImages =
    egg.images.length > 0
      ? egg.images
      : egg.images;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[85vh] max-w-2xl flex-col gap-0 p-0 sm:rounded-xl">
        {/* Header */}
        <div className={`h-1.5 w-full shrink-0 ${fam.bg}`} />

        <DialogHeader className="px-6 pb-0 pt-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-xl dark:text-white">
                {egg.name}
              </DialogTitle>
              <DialogDescription className="mt-1 line-clamp-2">
                {egg.description || 'No description provided.'}
              </DialogDescription>
            </div>
            <Badge
              className={`shrink-0 gap-1 border-transparent text-xs ${fam.bg} ${fam.color}`}
            >
              <span>{fam.icon}</span>
              {fam.label}
            </Badge>
          </div>
        </DialogHeader>

        {/* Body */}
        <ScrollArea className="flex-1 px-6 py-4">
          <div className="space-y-5">
            {/* Meta row */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>
                Author:{' '}
                <span className="font-medium text-foreground/80 dark:text-zinc-200">
                  {egg.author}
                </span>
              </span>
              <span>
                Category:{' '}
                <span className="font-medium text-foreground/80 dark:text-zinc-200">
                  {egg.categoryName}
                  {egg.subcategoryName ? ` › ${egg.subcategoryName}` : ''}
                </span>
              </span>
              <span>
                {egg.variableCount} variable{egg.variableCount !== 1 ? 's' : ''}
              </span>
              {egg.features.length > 0 && (
                <span className="flex items-center gap-1">
                  <Shield className="h-3 w-3" />
                  {egg.features.join(', ')}
                </span>
              )}
            </div>

            {/* Startup command */}
            <div>
              <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Terminal className="h-3 w-3" />
                Startup Command
              </label>
              <code className="block rounded-lg bg-surface-2 px-3 py-2 text-xs text-foreground/90 dark:bg-zinc-800/80 dark:text-zinc-200">
                {egg.startup}
              </code>
            </div>

            {/* Docker images */}
            <div>
              <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <ImageIcon className="h-3 w-3" />
                Docker Images ({displayImages.length})
              </label>
              <div className="flex flex-col gap-1">
                {displayImages.map((img, i) => (
                  <code
                    key={i}
                    className="rounded-md bg-surface-2 px-3 py-1.5 text-[11px] text-foreground/80 dark:bg-zinc-800/80 dark:text-zinc-300"
                  >
                    {img}
                  </code>
                ))}
              </div>
            </div>

            {/* Variables preview */}
            {egg.variables.length > 0 && (
              <div>
                <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <Settings className="h-3 w-3" />
                  Variables ({egg.variableCount}
                  {egg.variables.length < egg.variableCount
                    ? `, showing ${egg.variables.length}`
                    : ''}
                  )
                </label>
                <div className="overflow-hidden rounded-lg border border-border">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border bg-surface-2/50">
                        <th className="px-3 py-1.5 text-left font-medium text-muted-foreground">
                          Variable
                        </th>
                        <th className="px-3 py-1.5 text-left font-medium text-muted-foreground">
                          Default
                        </th>
                        <th className="hidden px-3 py-1.5 text-left font-medium text-muted-foreground sm:table-cell">
                          Required
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/50">
                      {egg.variables.map((v, i) => (
                        <tr key={i} className="hover:bg-surface-2/30">
                          <td className="px-3 py-1.5 font-mono font-medium text-foreground dark:text-zinc-200">
                            {v.name}
                          </td>
                          <td className="px-3 py-1.5 max-w-[180px] truncate font-mono text-muted-foreground">
                            {v.default || '—'}
                          </td>
                          <td className="hidden px-3 py-1.5 sm:table-cell">
                            {v.required ? (
                              <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
                                Required
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground">Optional</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Install script toggle */}
            {egg.hasInstallScript && (
              <div>
                <button
                  onClick={() => setShowScript(!showScript)}
                  className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                >
                  <FileCode className="h-3 w-3" />
                  Install Script
                  <span className="text-[10px]">
                    {showScript ? '(hide)' : '(show)'}
                  </span>
                </button>
                <AnimateScript show={showScript} eggId={egg.id} />
              </div>
            )}
          </div>
        </ScrollArea>

        {/* Footer — install controls */}
        <div className="border-t border-border bg-surface-1/50 px-6 py-4">
          {installed ? (
            <div className="flex items-center gap-2 text-sm font-medium text-success">
              <Check className="h-4 w-4" />
              Template imported successfully!
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              {/* Nest selector */}
              {nests.length > 0 && (
                <select
                  value={selectedNestId}
                  onChange={(e) => setSelectedNestId(e.target.value)}
                  className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 dark:bg-zinc-800 dark:text-zinc-200"
                >
                  <option value="">No nest</option>
                  {nests.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.name}
                    </option>
                  ))}
                </select>
              )}

              <Button
                onClick={handleInstall}
                disabled={installing}
                className="gap-2"
              >
                {installing ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Importing…
                  </>
                ) : (
                  <>
                    <Download className="h-4 w-4" />
                    Import as Template
                  </>
                )}
              </Button>

              {error && (
                <div className="flex items-center gap-1.5 text-xs text-danger">
                  <AlertCircle className="h-3.5 w-3.5" />
                  {error}
                </div>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Lazy-loaded install script viewer ──

function AnimateScript({ show, eggId }: { show: boolean; eggId: string }) {
  const [script, setScript] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!show) {
      setScript(null);
      return;
    }
    setLoading(true);
    fetchFullEgg(eggId)
      .then((egg) => {
        const s = egg.scripts?.installation?.script;
        setScript(s || null);
      })
      .catch(() => setScript(null))
      .finally(() => setLoading(false));
  }, [show, eggId]);

  if (!show) return null;

  return (
    <div className="mt-2 max-h-60 overflow-auto rounded-lg border border-border bg-surface-2 p-3">
      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-4/5" />
          <Skeleton className="h-3 w-3/5" />
        </div>
      ) : script ? (
        <pre className="whitespace-pre-wrap text-[11px] leading-relaxed text-muted-foreground">
          {script}
        </pre>
      ) : (
        <p className="text-xs text-muted-foreground">No install script available.</p>
      )}
    </div>
  );
}

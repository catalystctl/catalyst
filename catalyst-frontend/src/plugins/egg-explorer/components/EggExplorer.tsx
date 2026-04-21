// src/plugins/egg-explorer/components/EggExplorer.tsx
// Main admin tab component for browsing and installing Pterodactyl eggs.
//
// Fetches the full egg index (~248 eggs, ~450 KB) once on mount, then does
// all filtering / searching in-memory for instant responsiveness.

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search,
  RefreshCw,
  Egg,
  Loader2,
  X,
  Gamepad2,
  Clock,
  FolderOpen,
  Filter,
} from 'lucide-react';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Skeleton } from '../../../components/ui/skeleton';
import { ScrollArea, ScrollBar } from '../../../components/ui/scroll-area';
import { EggCard, EggCardSkeleton } from './EggCard';
import { EggDetailModal } from './EggDetailModal';
import { IMAGE_FAMILIES, POPULAR_FAMILIES } from '../constants';
import {
  fetchCategories,
  fetchStatus,
  triggerSync,
} from '../api';
import type { EggSummary, EggCategory, EggIndexStatus } from '../types';

// ─── Animation variants ─────────────────────────────────────────────────────

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.04, delayChildren: 0.1 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 280, damping: 22 } },
};

// ─── Client-side filter ─────────────────────────────────────────────────────

function filterEggs(
  allEggs: EggSummary[],
  search: string,
  category: string | null,
  subcategory: string | null,
  family: string | null,
): EggSummary[] {
  let filtered = allEggs;

  if (category) filtered = filtered.filter((e) => e.category === category);
  if (subcategory) filtered = filtered.filter((e) => e.subcategory === subcategory);
  if (family) filtered = filtered.filter((e) => e.imageFamily === family);
  if (search) {
    const q = search.toLowerCase();
    filtered = filtered.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        e.description.toLowerCase().includes(q) ||
        e.author.toLowerCase().includes(q) ||
        e.categoryName.toLowerCase().includes(q) ||
        (e.subcategoryName && e.subcategoryName.toLowerCase().includes(q)),
    );
  }

  return filtered;
}

// ─── Component ──────────────────────────────────────────────────────────────

const PAGE_SIZE = 48;

export function EggExplorer() {
  // ── All eggs (fetched once) ──
  const [allEggs, setAllEggs] = useState<EggSummary[]>([]);
  const [categories, setCategories] = useState<EggCategory[]>([]);

  // ── Filter state ──
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedSubcategory, setSelectedSubcategory] = useState<string | null>(null);
  const [selectedFamily, setSelectedFamily] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  // ── UI state ──
  const [status, setStatus] = useState<EggIndexStatus | null>(null);
  const [selectedEgg, setSelectedEgg] = useState<EggSummary | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [initialSyncDone, setInitialSyncDone] = useState(false);

  // ── Reset visible count when filters change ──
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [search, selectedCategory, selectedSubcategory, selectedFamily]);

  // ── Client-side filtered results (memoized) ──
  const filteredEggs = useMemo(
    () => filterEggs(allEggs, search, selectedCategory, selectedSubcategory, selectedFamily),
    [allEggs, search, selectedCategory, selectedSubcategory, selectedFamily],
  );

  const visibleEggs = useMemo(
    () => filteredEggs.slice(0, visibleCount),
    [filteredEggs, visibleCount],
  );

  const hasMore = visibleCount < filteredEggs.length;

  // ── Fetch status on mount ──
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const s = await fetchStatus();
        if (cancelled) return;
        setStatus(s);
        if (s.ready) {
          setInitialSyncDone(true);
          return true;
        }
        if (s.syncing) setSyncing(true);
        return false;
      } catch {
        return false;
      }
    };

    (async () => {
      let done = await poll();
      while (!done && !cancelled) {
        await new Promise((r) => setTimeout(r, 2000));
        done = await poll();
      }
    })();

    return () => { cancelled = true; };
  }, []);

  // Auto-trigger sync if not ready
  useEffect(() => {
    if (status && !status.ready && !status.syncing && !initialSyncDone) {
      triggerSync().catch(() => {});
    }
  }, [status, initialSyncDone]);

  // ── Fetch all eggs + categories once ready ──
  useEffect(() => {
    if (!initialSyncDone) return;

    setLoading(true);
    setError(null);

    Promise.all([fetchCategories()])
      .then(([catRes]) => {
        setCategories(catRes.data || []);
        // Eggs are already embedded in the categories response from the status check.
        // But we need the full list — fetch from the backend with a large page size.
        return fetch(`/api/plugins/egg-explorer/?pageSize=999`, {
          credentials: 'include',
        })
          .then((r) => r.json())
          .then((res) => {
            setAllEggs(res.data || []);
          });
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [initialSyncDone]);

  // ── Handlers ──
  const handleSync = useCallback(async () => {
    setSyncing(true);
    try {
      await triggerSync();
      let ready = false;
      while (!ready) {
        await new Promise((r) => setTimeout(r, 2000));
        const s = await fetchStatus();
        setStatus(s);
        if (s.ready) {
          ready = true;
          setInitialSyncDone(true);
          // Re-fetch everything
          const catRes = await fetchCategories();
          setCategories(catRes.data || []);
          const eggRes = await fetch('/api/plugins/egg-explorer/?pageSize=999', {
            credentials: 'include',
          }).then((r) => r.json());
          setAllEggs(eggRes.data || []);
        }
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSyncing(false);
    }
  }, []);

  const openEgg = useCallback((egg: EggSummary) => {
    setSelectedEgg(egg);
    setDetailOpen(true);
  }, []);

  const clearFilters = useCallback(() => {
    setSearch('');
    setSelectedCategory(null);
    setSelectedSubcategory(null);
    setSelectedFamily(null);
  }, []);

  // ── Derived ──
  const activeCategory = categories.find((c) => c.id === selectedCategory);
  const activeFiltersCount = [selectedCategory, selectedSubcategory, selectedFamily, search].filter(Boolean).length;

  // ─── Render ────────────────────────────────────────────────────────────

  // Loading / initial sync screen
  if (!initialSyncDone) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-24">
        <div className="relative">
          <div className="absolute -inset-4 rounded-2xl bg-gradient-to-r from-amber-500/20 to-orange-500/20 blur-xl" />
          <Egg className="relative h-12 w-12 animate-pulse text-amber-500" />
        </div>
        <div className="text-center">
          <h2 className="text-lg font-semibold text-foreground dark:text-white">
            Syncing Egg Repository
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {syncing
              ? 'Cloning and indexing 248 eggs from the Pterodactyl game-eggs repo…'
              : 'Connecting to the egg index…'}
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          This may take a moment on first load
        </div>
        <Button variant="outline" size="sm" onClick={handleSync} disabled={syncing} className="mt-2">
          <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} />
          {syncing ? 'Syncing…' : 'Retry Sync'}
        </Button>
      </div>
    );
  }

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="relative min-h-screen"
    >
      {/* Ambient glow */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-40 -right-40 h-96 w-96 rounded-full bg-gradient-to-br from-amber-500/6 to-orange-500/6 blur-3xl" />
        <div className="absolute bottom-0 -left-40 h-96 w-96 rounded-full bg-gradient-to-tr from-violet-500/6 to-cyan-500/6 blur-3xl" />
      </div>

      <div className="relative z-10 space-y-5">
        {/* ─── Header ─── */}
        <motion.div variants={itemVariants} className="flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-3">
              <div className="relative">
                <div className="absolute -inset-1 rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 opacity-20 blur-sm" />
                <Egg className="relative h-7 w-7 text-amber-600 dark:text-amber-400" />
              </div>
              <h1 className="font-display text-3xl font-bold tracking-tight text-foreground dark:text-white">
                Egg Explorer
              </h1>
            </div>
            <p className="ml-10 text-sm text-muted-foreground">
              Browse and install game server templates from the Pterodactyl community.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {status?.lastSync && (
              <Badge variant="outline" className="h-8 gap-1.5 px-3 text-xs">
                <Clock className="h-3 w-3" />
                Updated{' '}
                {new Date(status.lastSync).toLocaleDateString(undefined, {
                  month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                })}
              </Badge>
            )}
            <Badge variant="outline" className="h-8 gap-1.5 px-3 text-xs">
              <Gamepad2 className="h-3 w-3" />
              {filteredEggs.length} of {allEggs.length} eggs
            </Badge>
            <Badge variant="outline" className="h-8 gap-1.5 px-3 text-xs">
              <FolderOpen className="h-3 w-3" />
              {categories.length} categories
            </Badge>
            <Button variant="outline" size="sm" onClick={handleSync} disabled={syncing} className="gap-2">
              <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} />
              {syncing ? 'Syncing…' : 'Sync Now'}
            </Button>
          </div>
        </motion.div>

        {/* ─── Search + Filter bar ─── */}
        <motion.div variants={itemVariants} className="flex flex-wrap items-center gap-2.5">
          <div className="relative min-w-[200px] flex-1 max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search eggs by name, author, or description…"
              className="pl-9"
            />
          </div>

          {/* Image family filter */}
          <div className="flex items-center gap-1.5 overflow-x-auto">
            <Filter className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            {POPULAR_FAMILIES.map((fam) => {
              const meta = IMAGE_FAMILIES[fam];
              if (!meta) return null;
              const active = selectedFamily === fam;
              return (
                <button
                  key={fam}
                  onClick={() => setSelectedFamily(active ? null : fam)}
                  className={`flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition-all ${
                    active
                      ? `${meta.bg} ${meta.color} ring-1 ring-current/20`
                      : 'bg-surface-2 text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <span>{meta.icon}</span>
                  {meta.label}
                </button>
              );
            })}
          </div>

          {activeFiltersCount > 0 && (
            <Button variant="ghost" size="sm" onClick={clearFilters} className="gap-1.5 text-xs">
              <X className="h-3 w-3" />
              Clear
            </Button>
          )}

          <span className="text-xs text-muted-foreground">{filteredEggs.length} results</span>
        </motion.div>

        {/* ─── Category pills ─── */}
        <motion.div variants={itemVariants}>
          <ScrollArea className="w-full">
            <div className="flex items-center gap-1.5 pb-1">
              <button
                onClick={() => { setSelectedCategory(null); setSelectedSubcategory(null); }}
                className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all ${
                  !selectedCategory
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'bg-surface-2 text-muted-foreground hover:text-foreground'
                }`}
              >
                All
                <span className="text-[10px] opacity-70">{allEggs.length}</span>
              </button>
              {categories.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => { setSelectedCategory(selectedCategory === cat.id ? null : cat.id); setSelectedSubcategory(null); }}
                  className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all ${
                    selectedCategory === cat.id
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'bg-surface-2 text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {cat.name}
                  <span className="text-[10px] opacity-70">{cat.count}</span>
                </button>
              ))}
            </div>
            <ScrollBar orientation="horizontal" />
          </ScrollArea>
        </motion.div>

        {/* ─── Subcategory pills ─── */}
        <AnimatePresence>
          {activeCategory?.subcategories && activeCategory.subcategories.length > 1 && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="overflow-hidden"
            >
              <ScrollArea className="w-full">
                <div className="flex items-center gap-1.5 pb-1">
                  <button
                    onClick={() => setSelectedSubcategory(null)}
                    className={`flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition-all ${
                      !selectedSubcategory
                        ? 'bg-primary/80 text-primary-foreground'
                        : 'bg-surface-2/80 text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    All {activeCategory.name}
                  </button>
                  {activeCategory.subcategories.map((sub) => (
                    <button
                      key={sub.id}
                      onClick={() => setSelectedSubcategory(selectedSubcategory === sub.id ? null : sub.id)}
                      className={`flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition-all ${
                        selectedSubcategory === sub.id
                          ? 'bg-primary/80 text-primary-foreground'
                          : 'bg-surface-2/80 text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {sub.name}
                    </button>
                  ))}
                </div>
                <ScrollBar orientation="horizontal" />
              </ScrollArea>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ─── Error state ─── */}
        {error && (
          <div className="rounded-xl border border-danger/20 bg-danger/5 p-4">
            <div className="flex items-center gap-2 text-sm text-danger">
              {error}
            </div>
          </div>
        )}

        {/* ─── Egg grid ─── */}
        <motion.div variants={itemVariants}>
          {loading && allEggs.length === 0 ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {Array.from({ length: 12 }).map((_, i) => (
                <EggCardSkeleton key={i} />
              ))}
            </div>
          ) : visibleEggs.length > 0 ? (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {visibleEggs.map((egg, i) => (
                  <EggCard
                    key={egg.id}
                    egg={egg}
                    index={i}
                    onClick={() => openEgg(egg)}
                  />
                ))}
              </div>

              {hasMore && (
                <div className="mt-6 flex justify-center">
                  <Button
                    variant="outline"
                    onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
                    className="gap-2"
                  >
                    <Gamepad2 className="h-4 w-4" />
                    Show More ({visibleEggs.length} of {filteredEggs.length})
                  </Button>
                </div>
              )}
            </>
          ) : (
            <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-border bg-card/50 py-16">
              <Search className="h-10 w-10 text-muted-foreground/40" />
              <h3 className="text-lg font-medium text-foreground dark:text-zinc-200">
                No eggs found
              </h3>
              <p className="text-sm text-muted-foreground">
                {search || selectedCategory || selectedFamily
                  ? 'Try adjusting your search or filters.'
                  : 'No eggs are available. Try syncing the repository.'}
              </p>
              {(search || selectedCategory || selectedFamily) && (
                <Button variant="outline" size="sm" onClick={clearFilters}>
                  <X className="mr-1.5 h-3.5 w-3.5" />
                  Clear filters
                </Button>
              )}
            </div>
          )}
        </motion.div>
      </div>

      {/* ─── Detail modal ─── */}
      <EggDetailModal
        egg={selectedEgg}
        open={detailOpen}
        onClose={() => {
          setDetailOpen(false);
          setTimeout(() => setSelectedEgg(null), 200);
        }}
      />
    </motion.div>
  );
}

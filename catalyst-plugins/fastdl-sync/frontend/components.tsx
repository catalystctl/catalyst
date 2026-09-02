/**
 * Auto FastDL — admin tab.
 * Manage pairings, trigger syncs, and read the sv_downloadurl for each
 * FastDL server.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  StatsCard,
  cn,
  TEXT_MUTED,
  FONT_MONO,
  Plus,
  RefreshCw,
  Loader2,
  Copy,
  Trash2,
} from '@/plugins/plugin-ui';
import { AlertTriangle, CheckCircle2, Clock, Download } from 'lucide-react';
import * as api from './api';
import type { Pairing, CandidateServer, SyncRun } from './api';

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return `${Math.floor(s)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function RunRow({ run }: { run: SyncRun }) {
  return (
    <div className="flex items-center gap-2 text-xs py-1" style={{ color: TEXT_MUTED }}>
      {run.ok ? (
        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
      ) : (
        <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0" />
      )}
      <span className="shrink-0">{timeAgo(run.startedAt)}</span>
      <span className="truncate">{run.summary}</span>
      {run.errors?.length ? (
        <span className="shrink-0" title={run.errors.join('\n')}>
          ({run.errors.length} err)
        </span>
      ) : null}
    </div>
  );
}

function PairingCard({
  pairing,
  onSync,
  onDelete,
  syncing,
}: {
  pairing: Pairing;
  onSync: (id: string) => void;
  onDelete: (id: string) => void;
  syncing: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const url = pairing.fastdlServer?.downloadUrl;

  const copyUrl = () => {
    if (!url) return;
    navigator.clipboard?.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <span className="truncate">{pairing.sourceServer?.name ?? pairing.sourceServerUuid}</span>
            <span style={{ color: TEXT_MUTED }}>→</span>
            <span className="truncate text-emerald-400">
              {pairing.fastdlServer?.name ?? pairing.fastdlServerUuid}
            </span>
          </div>
          <div className="text-xs mt-0.5" style={{ color: TEXT_MUTED }}>
            {pairing.fileCount != null ? `${pairing.fileCount} files synced` : 'not synced yet'}
            {' · '}
            last sync {timeAgo(pairing.lastSyncAt)}
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Button size="sm" variant="outline" onClick={() => onSync(pairing.id)} disabled={syncing}>
            {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Sync now
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onDelete(pairing.id)} aria-label="Delete pairing">
            <Trash2 className="h-3.5 w-3.5 text-red-400" />
          </Button>
        </div>
      </div>

      {url && (
        <div className="flex items-center gap-2 text-xs">
          <span className="shrink-0" style={{ color: TEXT_MUTED }}>sv_downloadurl</span>
          <code
            className="flex-1 truncate rounded bg-zinc-950 px-2 py-1 cursor-pointer hover:bg-zinc-800"
            style={{ fontFamily: FONT_MONO }}
            onClick={copyUrl}
            title="Click to copy"
          >
            {copied ? 'copied!' : `sv_downloadurl "${url}"`}
          </code>
          <Button size="sm" variant="ghost" onClick={copyUrl} aria-label="Copy">
            <Copy className="h-3 w-3" />
          </Button>
        </div>
      )}

      {pairing.recentRuns?.length > 0 && (
        <div className="border-t border-zinc-800 pt-2">
          {pairing.recentRuns.slice(0, 3).map((run) => (
            <RunRow key={run.startedAt} run={run} />
          ))}
        </div>
      )}
    </div>
  );
}

export function FastdlAdminTab() {
  const [pairings, setPairings] = useState<Pairing[] | null>(null);
  const [candidates, setCandidates] = useState<CandidateServer[] | null>(null);
  const [sourceUuid, setSourceUuid] = useState('');
  const [fastdlUuid, setFastdlUuid] = useState('');
  const [creating, setCreating] = useState(false);
  const [syncingIds, setSyncingIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [p, c] = await Promise.all([api.fetchPairings(), api.fetchCandidates()]);
      setPairings(p);
      setCandidates(c);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load');
      setPairings([]);
      setCandidates([]);
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 15_000);
    return () => clearInterval(t);
  }, [refresh]);

  const createPairing = async () => {
    if (!sourceUuid || !fastdlUuid || creating) return;
    const src = candidates?.find((c) => c.uuid === sourceUuid);
    const dst = candidates?.find((c) => c.uuid === fastdlUuid);
    if (!src || !dst) return;
    setCreating(true);
    setError(null);
    try {
      await api.createPairing({
        sourceServerUuid: src.uuid,
        fastdlServerUuid: dst.uuid,
        sourceServerNodeId: src.nodeId,
        fastdlServerNodeId: dst.nodeId,
      });
      setSourceUuid('');
      setFastdlUuid('');
      await refresh();
    } catch (e: any) {
      setError(e?.message ?? 'Failed to create pairing');
    } finally {
      setCreating(false);
    }
  };

  const syncNow = async (id: string) => {
    setSyncingIds((prev) => new Set(prev).add(id));
    try {
      await api.triggerSync(id);
      // Give the run a moment, then refresh twice (start + finish)
      setTimeout(refresh, 1500);
      setTimeout(refresh, 6000);
    } catch (e: any) {
      setError(e?.message ?? 'Sync failed to start');
    } finally {
      setTimeout(() => {
        setSyncingIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }, 6000);
    }
  };

  const deletePairing = async (id: string) => {
    try {
      await api.deletePairing(id);
      await refresh();
    } catch (e: any) {
      setError(e?.message ?? 'Delete failed');
    }
  };

  const serverOptions = candidates ?? [];
  const totalFiles = pairings?.reduce((acc, p) => acc + (p.fileCount ?? 0), 0) ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-1 flex items-center gap-2">
          <Download className="h-6 w-6 text-emerald-400" /> Auto FastDL
        </h2>
        <p className="text-sm" style={{ color: TEXT_MUTED }}>
          Mirrors game-server content (maps, models, sounds, materials) into FastDL servers. Upload
          once — joining clients download everything automatically. Add{' '}
          <code style={{ fontFamily: FONT_MONO }}>sv_downloadurl "http://&lt;fastdl-ip&gt;:&lt;port&gt;"</code>{' '}
          on each game server.
        </p>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-700/40 bg-amber-950/30 px-3 py-2 text-sm text-amber-300">
          <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatsCard label="Pairings" value={String(pairings?.length ?? 0)} />
        <StatsCard label="Files synced" value={String(totalFiles)} />
        <StatsCard
          label="Healthy"
          value={pairings ? String(pairings.filter((p) => p.recentRuns?.[0]?.ok !== false).length) : '…'}
        />
      </div>

      {/* New pairing */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
        <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <Plus className="h-4 w-4" /> New pairing
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-3 items-center">
          <Select value={sourceUuid} onValueChange={setSourceUuid}>
            <SelectTrigger>
              <SelectValue placeholder="Game server (source)" />
            </SelectTrigger>
            <SelectContent>
              {serverOptions.map((s) => (
                <SelectItem key={s.uuid} value={s.uuid}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={fastdlUuid} onValueChange={setFastdlUuid}>
            <SelectTrigger>
              <SelectValue placeholder="FastDL server (target)" />
            </SelectTrigger>
            <SelectContent>
              {serverOptions.map((s) => (
                <SelectItem key={s.uuid} value={s.uuid}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={createPairing} disabled={!sourceUuid || !fastdlUuid || creating}>
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Pair'}
          </Button>
        </div>
      </div>

      {/* Pairing list */}
      {pairings === null ? (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : pairings.length === 0 ? (
        <div
          className="rounded-lg border border-dashed border-zinc-800 p-8 text-center text-sm"
          style={{ color: TEXT_MUTED }}
        >
          <Clock className="h-6 w-6 mx-auto mb-2 opacity-50" />
          No pairings yet. Pair a game server with your FastDL server above.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {pairings.map((p) => (
            <PairingCard
              key={p.id}
              pairing={p}
              onSync={syncNow}
              onDelete={deletePairing}
              syncing={syncingIds.has(p.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

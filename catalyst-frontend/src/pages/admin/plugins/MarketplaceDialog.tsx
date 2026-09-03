import { useMemo, useState } from 'react';
import { useQuery, useMutation } from '@/csync';
import {
  ExternalLink,
  Loader2,
  PackageCheck,
  Plus,
  RefreshCw,
  Search,
  Store,
  Trash2,
} from 'lucide-react';

import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  addMarketplaceSource,
  deleteMarketplaceSource,
  fetchMarketplace,
  fetchMarketplaceSources,
  installPlugin,
  updateMarketplaceSource,
  type MarketplaceEntry,
  type MarketplaceSource,
} from '../../../plugins/api';
import { toast } from 'sonner';

/** Host label for a marketplace URL that never throws on malformed input. */
function sourceHostLabel(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

/** True when marketplace is a strictly newer x.y.z than the installed copy. */
function isNewerVersion(installed: string | null | undefined, marketplace: string | null | undefined): boolean {
  if (!installed || !marketplace) return false;
  const parts = (v: string) => v.split('.').map((n) => Number.parseInt(n, 10) || 0);
  const a = parts(installed);
  const b = parts(marketplace);
  for (let i = 0; i < 3; i++) {
    if ((b[i] ?? 0) > (a[i] ?? 0)) return true;
    if ((b[i] ?? 0) < (a[i] ?? 0)) return false;
  }
  return false;
}

/**
 * Marketplace browser: lists plugin packages from the configured index
 * sources and installs them into the panel. Installing places inert code —
 * enabling still runs through the safety-consent gate.
 */
export function MarketplaceDialog({
  open,
  onOpenChange,
  onInstalled,
  installedVersions,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after any successful install so lists refresh. */
  onInstalled: () => void;
  /** Installed plugin name → version, used to flag updates even if the API omits it. */
  installedVersions?: Record<string, string>;
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [installingName, setInstallingName] = useState<string | null>(null);
  const [newSourceUrl, setNewSourceUrl] = useState('');
  const [newSourceLabel, setNewSourceLabel] = useState('');
  const [pendingSourceId, setPendingSourceId] = useState<string | null>(null);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['plugins', 'marketplace'],
    queryFn: () => fetchMarketplace(true),
    enabled: open,
    staleTime: 0,
  });

  const {
    data: sources,
    isLoading: sourcesLoading,
    refetch: refetchSources,
  } = useQuery({
    queryKey: ['plugins', 'marketplace-sources'],
    queryFn: () => fetchMarketplaceSources(),
    enabled: open,
    staleTime: 0,
  });

  const refreshMarketplace = () => {
    refetchSources();
    refetch();
  };

  const addSourceMutation = useMutation({
    mutationFn: ({ url, label }: { url: string; label?: string }) => addMarketplaceSource(url, label),
    onMutate: () => setPendingSourceId('new'),
    onSuccess: (source: MarketplaceSource) => {
      toast.success(`Marketplace added — browsing ${sourceHostLabel(source.url)} together with the others`);
      setNewSourceUrl('');
      setNewSourceLabel('');
      refreshMarketplace();
    },
    onSettled: () => setPendingSourceId(null),
    onError: (error: any) => toast.error(error?.message || 'Could not add marketplace'),
  });

  const toggleSourceMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      updateMarketplaceSource(id, enabled),
    onMutate: ({ id }) => setPendingSourceId(id),
    onSuccess: () => refreshMarketplace(),
    onSettled: () => setPendingSourceId(null),
    onError: (error: any) => toast.error(error?.message || 'Could not update marketplace'),
  });

  const deleteSourceMutation = useMutation({
    mutationFn: ({ id }: { id: string }) => deleteMarketplaceSource(id),
    onMutate: ({ id }) => setPendingSourceId(id),
    onSuccess: () => {
      toast.success('Marketplace removed');
      refreshMarketplace();
    },
    onSettled: () => setPendingSourceId(null),
    onError: (error: any) => toast.error(error?.message || 'Could not remove marketplace'),
  });

  const installMutation = useMutation({
    mutationFn: ({ entry }: { entry: MarketplaceEntry }) =>
      installPlugin(entry.downloadUrl, entry.sha256),
    onMutate: ({ entry }) => setInstallingName(entry.name),
    onSuccess: (result) => {
      toast.success(
        `${result.name}@${result.version} ${result.upgraded ? 'upgraded' : 'installed'} — accept the safety disclaimer to enable it`,
        { duration: 6000 },
      );
      onInstalled();
      refetch();
    },
    onSettled: () => setInstallingName(null),
    onError: (error: any) => toast.error(error?.message || 'Install failed'),
  });

  const filteredEntries = useMemo(() => {
    if (!data?.entries) return [];
    const q = searchQuery.trim().toLowerCase();
    const annotated = data.entries.map((entry) => {
      const installedVersion = entry.installedVersion ?? installedVersions?.[entry.name] ?? null;
      const installed = Boolean(entry.installed || installedVersion);
      const updateAvailable =
        Boolean(entry.updateAvailable) || isNewerVersion(installedVersion, entry.version);
      return { ...entry, installed, installedVersion, updateAvailable };
    });
    if (!q) return annotated;
    return annotated.filter((e) =>
      [e.displayName ?? '', e.name, e.description ?? '', e.author ?? '', ...(e.tags ?? [])]
        .join(' ')
        .toLowerCase()
        .includes(q),
    );
  }, [data?.entries, searchQuery, installedVersions]);

  const healthByUrl = useMemo(() => {
    const map = new Map<string, { ok: boolean; error?: string; entryCount: number }>();
    for (const s of data?.sources ?? []) map.set(s.url, s);
    return map;
  }, [data?.sources]);

  const originLabel: Record<MarketplaceSource['origin'], string> = {
    official: 'Official',
    env: 'Env',
    custom: 'Added',
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" data-testid="plugin-marketplace">
        <DialogHeader icon={<Store className="h-4 w-4" />}>
          <DialogTitle>Plugin marketplace</DialogTitle>
          <DialogDescription>
            Discover and install community plugins. Installed code stays disabled until you
            review its permissions and accept the safety disclaimer.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div className="space-y-4">
            {/* In-panel source manager: add more marketplaces without env edits. */}
            <section
              aria-label="Marketplaces"
              className="rounded-lg border border-border/60 bg-surface-2/20 px-4 py-3"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-foreground">
                  Marketplaces
                  {sources && sources.length > 0 && (
                    <span className="ml-2 font-mono text-[11px] text-muted-foreground">
                      {sources.length}
                    </span>
                  )}
                </p>
                <p className="text-[11px] text-muted-foreground">Browsed together</p>
              </div>
              {sourcesLoading ? (
                <div className="flex items-center gap-2 py-3 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading marketplaces…
                </div>
              ) : sources && sources.length > 0 ? (
                <ul className="mt-2 divide-y divide-border/40">
                  {sources.map((source) => {
                    const health = healthByUrl.get(source.url);
                    const busy = pendingSourceId === source.id;
                    return (
                      <li key={source.id} className="flex items-center gap-2 py-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="max-w-full truncate text-xs font-medium text-foreground">
                              {source.label?.trim() || sourceHostLabel(source.url)}
                            </span>
                            <Badge variant="outline" className="text-[10px]">
                              {originLabel[source.origin]}
                            </Badge>
                            {!source.enabled ? (
                              <Badge variant="secondary" className="text-[10px]">
                                Disabled
                              </Badge>
                            ) : health ? (
                              <span
                                className="font-mono text-[10px] text-muted-foreground"
                                title={health.error ?? source.url}
                              >
                                {health.ok ? `${health.entryCount} plugins` : health.error}
                              </span>
                            ) : null}
                          </div>
                          <p
                            className="max-w-full truncate font-mono text-[10px] text-muted-foreground/70"
                            title={source.url}
                          >
                            {source.url}
                          </p>
                        </div>
                        {source.removable ? (
                          <>
                            <Switch
                              checked={source.enabled}
                              disabled={busy}
                              aria-label={`${source.enabled ? 'Disable' : 'Enable'} ${source.url}`}
                              onCheckedChange={(checked) =>
                                toggleSourceMutation.mutate({ id: source.id, enabled: checked })
                              }
                            />
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`Remove ${source.url}`}
                              disabled={busy}
                              onClick={() => deleteSourceMutation.mutate({ id: source.id })}
                            >
                              {busy ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Trash2 className="h-3.5 w-3.5" />
                              )}
                            </Button>
                          </>
                        ) : (
                          <Badge variant="secondary" className="shrink-0 text-[10px]">
                            Always on
                          </Badge>
                        )}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="mt-1 text-xs text-muted-foreground">
                  No marketplace configured. Add one below to start browsing.
                </p>
              )}
              <form
                className="mt-2 flex flex-col gap-2 sm:flex-row"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!newSourceUrl.trim() || pendingSourceId === 'new') return;
                  addSourceMutation.mutate({
                    url: newSourceUrl.trim(),
                    label: newSourceLabel.trim() || undefined,
                  });
                }}
              >
                <Input
                  value={newSourceUrl}
                  onChange={(e) => setNewSourceUrl(e.target.value)}
                  placeholder="https://example.com/index.json"
                  aria-label="New marketplace URL"
                  inputMode="url"
                  className="flex-1 font-mono text-xs"
                />
                <Input
                  value={newSourceLabel}
                  onChange={(e) => setNewSourceLabel(e.target.value)}
                  placeholder="Label (optional)"
                  aria-label="New marketplace label"
                  className="sm:w-36"
                />
                <Button
                  type="submit"
                  size="sm"
                  disabled={!newSourceUrl.trim() || pendingSourceId === 'new'}
                >
                  {pendingSourceId === 'new' ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Plus className="h-3.5 w-3.5" />
                  )}
                  Add
                </Button>
              </form>
            </section>

            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/50" />
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search marketplace…"
                  className="pl-8"
                  aria-label="Search marketplace"
                />
              </div>
              <Button
                variant="outline"
                size="icon-sm"
                aria-label="Refresh marketplace"
                onClick={() => refreshMarketplace()}
              >
                {isFetching ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
              </Button>
            </div>

            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : !data || data.sources.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border/50 bg-surface-2/20 px-6 py-8 text-center">
                <p className="text-sm font-medium text-foreground">No marketplace configured</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Add your first index URL in the Marketplaces section above — it is browsed
                  together with the official source. See docs/plugins.md for the index schema.
                </p>
              </div>
            ) : filteredEntries.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border/50 bg-surface-2/20 px-6 py-8 text-center">
                <p className="text-sm text-muted-foreground">No plugins match your search.</p>
              </div>
            ) : (
              <ul className="divide-y divide-border/40 rounded-lg border border-border/60">
                {filteredEntries.map((entry) => (
                  <li key={`${entry.name}:${entry.version ?? ''}`} className="flex items-start gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-foreground">
                          {entry.displayName ?? entry.name}
                        </span>
                        {entry.version && (
                          <span className="type-meta font-mono text-[11px] text-muted-foreground">
                            v{entry.version}
                          </span>
                        )}
                        {entry.updateAvailable ? (
                          <Badge variant="outline" className="gap-1 border-warning/40 text-warning text-[10px]">
                            Update {entry.installedVersion ? `${entry.installedVersion} → ${entry.version}` : `v${entry.version}`}
                          </Badge>
                        ) : entry.installed ? (
                          <Badge variant="secondary" className="gap-1 text-[10px]">
                            <PackageCheck className="h-3 w-3" />
                            Installed
                          </Badge>
                        ) : null}
                      </div>
                      <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                        {entry.description}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        {entry.author && (
                          <span className="text-[11px] text-muted-foreground/70">{entry.author}</span>
                        )}
                        {entry.sourceUrl && (data?.sources.length ?? 0) > 1 && (
                          <span
                            className="max-w-full truncate font-mono text-[10px] text-muted-foreground/60"
                            title={entry.sourceUrl}
                          >
                            via {sourceHostLabel(entry.sourceUrl)}
                          </span>
                        )}
                        {(entry.tags ?? []).slice(0, 4).map((tag) => (
                          <Badge key={tag} variant="outline" className="text-[10px]">
                            {tag}
                          </Badge>
                        ))}
                        {entry.homepage && (
                          <a
                            href={entry.homepage}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="inline-flex items-center gap-0.5 text-[11px] text-primary hover:underline"
                          >
                            Homepage
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant={entry.updateAvailable ? 'default' : entry.installed ? 'outline' : 'default'}
                      onClick={() => installMutation.mutate({ entry })}
                      disabled={installingName === entry.name || (entry.installed && !entry.updateAvailable)}
                      title={
                        entry.updateAvailable
                          ? `Update ${entry.name} to ${entry.version}`
                          : entry.installed
                            ? `${entry.name} is already ${entry.installedVersion ?? entry.version}`
                            : `Install ${entry.name}`
                      }
                    >
                      {installingName === entry.name && (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      )}
                      {entry.updateAvailable ? 'Update' : entry.installed ? 'Installed' : 'Install'}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

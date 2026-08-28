import { useMemo, useState } from 'react';
import { useQuery, useMutation } from '@/csync';
import {
  ExternalLink,
  Loader2,
  PackageCheck,
  RefreshCw,
  Search,
  Store,
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
import { fetchMarketplace, installPlugin, type MarketplaceEntry } from '../../../plugins/api';
import { toast } from 'sonner';

/**
 * Marketplace browser: lists plugin packages from the configured index
 * sources and installs them into the panel. Installing places inert code —
 * enabling still runs through the safety-consent gate.
 */
export function MarketplaceDialog({
  open,
  onOpenChange,
  onInstalled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after any successful install so lists refresh. */
  onInstalled: () => void;
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [installingName, setInstallingName] = useState<string | null>(null);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['plugins', 'marketplace'],
    queryFn: () => fetchMarketplace(false),
    enabled: open,
    staleTime: 60_000,
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
    if (!q) return data.entries;
    return data.entries.filter((e) =>
      [e.displayName ?? '', e.name, e.description ?? '', e.author ?? '', ...(e.tags ?? [])]
        .join(' ')
        .toLowerCase()
        .includes(q),
    );
  }, [data?.entries, searchQuery]);

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
                onClick={() => refetch()}
              >
                {isFetching ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
              </Button>
            </div>

            {/* Source health */}
            {data && data.sources.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {data.sources.map((s) => (
                  <Badge
                    key={s.url}
                    variant={s.ok ? 'outline' : 'destructive'}
                    className="max-w-full truncate font-mono text-[10px]"
                    title={s.error ?? s.url}
                  >
                    {new URL(s.url).host} · {s.ok ? `${s.entryCount}` : s.error}
                  </Badge>
                ))}
              </div>
            )}

            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : !data || data.sources.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border/50 bg-surface-2/20 px-6 py-8 text-center">
                <p className="text-sm font-medium text-foreground">No marketplace configured</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Set <code className="font-mono">PLUGIN_MARKETPLACE_URLS</code> (comma-separated
                  index URLs) in the backend environment to enable browsing. Any host can publish
                  an index document — see docs/plugins.md for the schema.
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
                        {entry.installed && (
                          <Badge variant="secondary" className="gap-1 text-[10px]">
                            <PackageCheck className="h-3 w-3" />
                            Installed
                          </Badge>
                        )}
                      </div>
                      <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                        {entry.description}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        {entry.author && (
                          <span className="text-[11px] text-muted-foreground/70">{entry.author}</span>
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
                      variant={entry.installed ? 'outline' : 'default'}
                      onClick={() => installMutation.mutate({ entry })}
                      disabled={installingName === entry.name}
                      title={entry.installed ? `Reinstall / update ${entry.name}` : `Install ${entry.name}`}
                    >
                      {installingName === entry.name && (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      )}
                      {entry.installed ? 'Update' : 'Install'}
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

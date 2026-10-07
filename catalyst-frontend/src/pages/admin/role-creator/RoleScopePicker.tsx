import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Globe, Search, Server } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/** Where a role's resource permissions apply. */
export type AccessBoundary = 'panel' | 'all' | 'nodes' | 'servers';

export interface ScopeNode {
  id: string;
  name: string;
  hostname?: string;
}

export interface ScopeServer {
  id: string;
  name: string;
  nodeName?: string;
  primaryPort?: number | null;
}

const MODES: Array<{ mode: AccessBoundary; titleKey: string; helpKey: string }> = [
  {
    mode: 'panel',
    titleKey: 'roles.creator.boundary.panelTitle',
    helpKey: 'roles.creator.boundary.panelHelp',
  },
  {
    mode: 'all',
    titleKey: 'roles.creator.boundary.allTitle',
    helpKey: 'roles.creator.boundary.allHelp',
  },
  {
    mode: 'nodes',
    titleKey: 'roles.creator.boundary.nodesTitle',
    helpKey: 'roles.creator.boundary.nodesHelp',
  },
  {
    mode: 'servers',
    titleKey: 'roles.creator.boundary.serversTitle',
    helpKey: 'roles.creator.boundary.serversHelp',
  },
];

/**
 * Boundary picker — "Where this role applies".
 *
 * `panel` and `all` need no resource list; `nodes` and `servers` reveal the
 * matching picker. The four modes map onto the backend's three scope modes
 * (`all` is `mode: 'nodes'` with the `*` wildcard), which is why they are
 * presented as one decision rather than a mode plus a checkbox.
 */
export function RoleScopePicker({
  boundary,
  onBoundaryChange,
  nodes,
  servers,
  selectedNodeIds,
  onToggleNode,
  selectedServerIds,
  onToggleServer,
  search,
  onSearchChange,
  disabled,
}: {
  boundary: AccessBoundary;
  onBoundaryChange: (boundary: AccessBoundary) => void;
  nodes: ScopeNode[];
  servers: ScopeServer[];
  selectedNodeIds: string[];
  onToggleNode: (id: string) => void;
  selectedServerIds: string[];
  onToggleServer: (id: string) => void;
  search: string;
  onSearchChange: (value: string) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation('admin-access');

  const showPicker = boundary === 'nodes' || boundary === 'servers';
  const query = search.trim().toLowerCase();

  const visibleNodes = useMemo(
    () =>
      nodes.filter(
        (n) =>
          !query ||
          n.name.toLowerCase().includes(query) ||
          (n.hostname?.toLowerCase().includes(query) ?? false),
      ),
    [nodes, query],
  );

  const visibleServers = useMemo(
    () =>
      servers.filter(
        (s) =>
          !query ||
          s.name.toLowerCase().includes(query) ||
          (s.nodeName?.toLowerCase().includes(query) ?? false),
      ),
    [servers, query],
  );

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {MODES.map(({ mode, titleKey, helpKey }) => {
          const active = boundary === mode;
          return (
            <button
              key={mode}
              type="button"
              disabled={disabled}
              aria-pressed={active}
              onClick={() => onBoundaryChange(mode)}
              className={cn(
                'relative rounded-sm border p-3 pr-8 text-left transition-colors',
                active
                  ? 'border-primary/50 bg-primary/5'
                  : 'border-border bg-card hover:border-primary/25',
                disabled && 'cursor-not-allowed opacity-60',
              )}
            >
              <span
                aria-hidden
                className={cn(
                  'absolute right-2.5 top-2.5 h-3.5 w-3.5 rounded-full border',
                  active
                    ? 'border-primary bg-primary shadow-[inset_0_0_0_3px_hsl(var(--card))]'
                    : 'border-border',
                )}
              />
              <span
                className={cn(
                  'block text-mini font-semibold',
                  active ? 'text-primary' : 'text-foreground',
                )}
              >
                {t(titleKey)}
              </span>
              <span className="mt-1 block text-micro leading-snug text-muted-foreground">
                {t(helpKey)}
              </span>
            </button>
          );
        })}
      </div>

      {showPicker && (
        <div className="rounded-sm border border-border bg-surface-1/40 p-3">
          <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-mini font-semibold text-foreground">
                {boundary === 'nodes'
                  ? t('roles.creator.boundary.chooseNodes')
                  : t('roles.creator.boundary.chooseServers')}
              </div>
              <div className="text-micro text-muted-foreground">
                {boundary === 'nodes'
                  ? t('roles.creator.boundary.chooseNodesHelp')
                  : t('roles.creator.boundary.chooseServersHelp')}
              </div>
            </div>
            <label className="relative flex w-full items-center sm:w-56">
              <Search className="pointer-events-none absolute left-2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={search}
                disabled={disabled}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder={
                  boundary === 'nodes'
                    ? t('roles.creator.boundary.searchNodes')
                    : t('roles.creator.boundary.searchServers')
                }
                className="h-7 pl-7 text-micro"
              />
            </label>
          </div>

          <div className="grid max-h-48 grid-cols-1 gap-1.5 overflow-y-auto pr-1 lg:grid-cols-2">
            {boundary === 'nodes'
              ? visibleNodes.map((node) => (
                  <SelectorRow
                    key={node.id}
                    icon={<Server className="h-3 w-3" />}
                    label={node.name}
                    meta={node.hostname}
                    selected={selectedNodeIds.includes(node.id)}
                    disabled={disabled}
                    onToggle={() => onToggleNode(node.id)}
                  />
                ))
              : visibleServers.map((server) => (
                  <SelectorRow
                    key={server.id}
                    icon={<Server className="h-3 w-3" />}
                    label={server.name}
                    meta={
                      server.nodeName
                        ? server.primaryPort
                          ? `${server.nodeName} · ${server.primaryPort}`
                          : server.nodeName
                        : undefined
                    }
                    selected={selectedServerIds.includes(server.id)}
                    disabled={disabled}
                    onToggle={() => onToggleServer(server.id)}
                  />
                ))}

            {(boundary === 'nodes' ? visibleNodes : visibleServers).length === 0 && (
              <div className="col-span-full flex items-center gap-2 px-1 py-3 text-micro text-muted-foreground">
                <Globe className="h-3.5 w-3.5" />
                {boundary === 'nodes'
                  ? t('roles.creator.boundary.noNodesMatch')
                  : t('roles.creator.boundary.noServersMatch')}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function SelectorRow({
  icon,
  label,
  meta,
  selected,
  disabled,
  onToggle,
}: {
  icon: React.ReactNode;
  label: string;
  meta?: string;
  selected: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={selected}
      disabled={disabled}
      onClick={onToggle}
      className={cn(
        'flex min-h-9 items-center gap-2.5 rounded-sm border px-2.5 py-1.5 text-left transition-colors',
        selected ? 'border-primary/40 bg-primary/5' : 'border-border bg-card hover:border-primary/25',
        disabled && 'cursor-not-allowed opacity-60',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] border',
          selected ? 'border-primary bg-primary text-primary-foreground' : 'border-border',
        )}
      >
        {selected && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
      </span>
      <span className="shrink-0 text-muted-foreground">{icon}</span>
      <span className="min-w-0 flex-1 truncate text-mini text-foreground">{label}</span>
      {meta && (
        <span className="shrink-0 truncate text-micro text-muted-foreground">{meta}</span>
      )}
    </button>
  );
}

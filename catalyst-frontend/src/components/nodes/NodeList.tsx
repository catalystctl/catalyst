import { useTranslation } from 'react-i18next';
import { Server } from 'lucide-react';
import type { NodeInfo } from '../../types/node';
import NodeCard, { NODE_GRID } from './NodeCard';

/**
 * Fleet rows in one deck panel: sticky column header + dense zebra rows.
 * Replaces the old two-column card grid.
 */
function NodeList({ nodes, latestAgentVersion }: { nodes: NodeInfo[]; latestAgentVersion?: string | null }) {
  const { t } = useTranslation('nodes');

  if (!nodes.length) {
    return (
      <div className="deck-panel flex flex-col items-center justify-center gap-1.5 py-12 text-center">
        <Server className="h-4 w-4 text-muted-foreground" />
        <p className="type-meta">{t('list.emptyTitle')}</p>
        <p className="type-overline">{t('list.emptyDescription')}</p>
      </div>
    );
  }

  return (
    <div className="deck-panel flex min-h-0 flex-col overflow-hidden">
      {/* Column header — same grid as the rows */}
      <div
        className={`${NODE_GRID} hidden border-b border-border/50 bg-surface-1 px-3 py-1.5 text-muted-foreground/70 md:grid`}
      >
        <span className="type-overline" aria-hidden />
        <span className="type-overline hidden justify-end xl:inline-flex">{t('servers.title')}</span>
        <span className="type-overline hidden justify-end md:inline-flex">{t('card.cpu')}</span>
        <span className="type-overline hidden justify-end md:inline-flex">{t('card.memory')}</span>
        <span className="type-overline justify-self-end">{t('card.manage')}</span>
      </div>

      <div className="divide-y divide-border/40">
        {nodes.map((node, i) => (
          <NodeCard key={node.id} node={node} index={i} latestAgentVersion={latestAgentVersion} />
        ))}
      </div>
    </div>
  );
}

export default NodeList;

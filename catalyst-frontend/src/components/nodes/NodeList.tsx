import { useTranslation } from 'react-i18next';
import type { NodeInfo } from '../../types/node';
import EmptyState from '../shared/EmptyState';
import NodeCard from './NodeCard';

function NodeList({ nodes, latestAgentVersion }: { nodes: NodeInfo[]; latestAgentVersion?: string | null }) {
 const { t } = useTranslation('nodes');
 if (!nodes.length) {
 return (
 <EmptyState
 title={t('list.emptyTitle')}
 description={t('list.emptyDescription')}
 />
 );
 }

 return (
 <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
 {nodes.map((node, i) => (
 <NodeCard key={node.id} node={node} index={i} latestAgentVersion={latestAgentVersion} />
 ))}
 </div>
 );
}

export default NodeList;

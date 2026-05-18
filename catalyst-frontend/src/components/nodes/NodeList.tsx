import type { NodeInfo } from '../../types/node';
import EmptyState from '../shared/EmptyState';
import NodeCard from './NodeCard';

function NodeList({ nodes, latestAgentVersion }: { nodes: NodeInfo[]; latestAgentVersion?: string | null }) {
 if (!nodes.length) {
 return (
 <EmptyState
 title="No nodes detected"
 description="Install the Catalyst agent and register nodes to begin."
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

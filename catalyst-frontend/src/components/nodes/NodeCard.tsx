import { Link } from 'react-router-dom';
import { Server, Cpu, HardDrive, ExternalLink } from 'lucide-react';
import type { NodeInfo } from '../../types/node';
import NodeStatusBadge from './NodeStatusBadge';

function NodeCard({ node }: { node: NodeInfo }) {
  const lastSeen = node.lastSeenAt ? new Date(node.lastSeenAt).toLocaleString() : 'n/a';
  const serverCount = node._count?.servers ?? node.servers?.length ?? 0;
  const memoryGB = node.maxMemoryMb ? (node.maxMemoryMb / 1024).toFixed(1) : 0;

  return (
    <div className="group relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-surface-light transition-all duration-300 hover:-translate-y-1 hover:border-primary-500 hover:shadow-lg dark:border-slate-800 dark:bg-slate-900 dark:shadow-surface-dark dark:hover:border-primary-500/30">
      <div className={`absolute left-0 top-0 h-full w-1 ${node.isOnline ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-700'}`} />
      
      <div className="p-5 pl-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
              node.isOnline 
                ? 'bg-emerald-100 dark:bg-emerald-900/30' 
                : 'bg-slate-100 dark:bg-slate-800'
            }`}>
              <Server className={`h-5 w-5 ${
                node.isOnline 
                  ? 'text-emerald-600 dark:text-emerald-400' 
                  : 'text-slate-400 dark:text-slate-500'
              }`} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <Link
                  to={`/admin/nodes/${node.id}`}
                  className="text-lg font-semibold text-slate-900 transition-colors hover:text-primary-600 dark:text-white dark:hover:text-primary-400"
                >
                  {node.name}
                </Link>
                <NodeStatusBadge isOnline={node.isOnline} />
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                <span className="font-mono">{node.hostname ?? 'hostname n/a'}</span>
                <span className="text-slate-300 dark:text-slate-600">|</span>
                <span>Last seen {lastSeen}</span>
              </div>
            </div>
          </div>
          <Link
            to={`/admin/nodes/${node.id}`}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition-all hover:border-primary-500 hover:text-primary-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-primary-500/50 dark:hover:text-primary-400"
          >
            Manage
            <ExternalLink className="h-3 w-3" />
          </Link>
        </div>

        <div className="mt-5 grid grid-cols-3 gap-3">
          <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-3 dark:border-slate-800 dark:bg-slate-800/30">
            <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
              <Server className="h-3.5 w-3.5" />
              <span>Servers</span>
            </div>
            <div className="mt-1.5 text-xl font-semibold text-slate-900 dark:text-slate-100">
              {serverCount}
            </div>
          </div>
          <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-3 dark:border-slate-800 dark:bg-slate-800/30">
            <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
              <Cpu className="h-3.5 w-3.5" />
              <span>CPU</span>
            </div>
            <div className="mt-1.5 text-xl font-semibold text-slate-900 dark:text-slate-100">
              {node.maxCpuCores ?? 0}
              <span className="ml-1 text-xs font-normal text-slate-400">cores</span>
            </div>
          </div>
          <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-3 dark:border-slate-800 dark:bg-slate-800/30">
            <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
              <HardDrive className="h-3.5 w-3.5" />
              <span>Memory</span>
            </div>
            <div className="mt-1.5 text-xl font-semibold text-slate-900 dark:text-slate-100">
              {memoryGB}
              <span className="ml-1 text-xs font-normal text-slate-400">GB</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default NodeCard;

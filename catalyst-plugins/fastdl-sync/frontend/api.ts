/**
 * Auto FastDL — typed API client via the host plugin SDK.
 */

import { createPluginApi } from '@/plugins/plugin-definition';

const api = createPluginApi('fastdl-sync');

export interface FastdlServerInfo {
  uuid: string;
  name: string;
  status?: string;
  downloadUrl?: string;
}

export interface SyncRun {
  startedAt: string;
  finishedAt: string | null;
  ok: boolean;
  summary: string;
  copied?: number;
  deleted?: number;
  bz2Generated?: number;
  skipped?: number;
  errors?: string[];
}

export interface Pairing {
  id: string;
  sourceServerUuid: string;
  fastdlServerUuid: string;
  sourceServerNodeId: string;
  fastdlServerNodeId: string;
  createdAt: string;
  sourceServer: FastdlServerInfo | null;
  fastdlServer: FastdlServerInfo | null;
  lastSyncAt: string | null;
  fileCount: number | null;
  recentRuns: SyncRun[];
}

export interface CandidateServer {
  id: string;
  uuid: string;
  name: string;
  nodeId: string;
}

export async function fetchPairings(): Promise<Pairing[]> {
  const res = await api.get('/pairings');
  return res.pairings ?? [];
}

export async function fetchCandidates(): Promise<CandidateServer[]> {
  const res = await api.get('/candidates');
  return res.servers ?? [];
}

export async function createPairing(payload: {
  sourceServerUuid: string;
  fastdlServerUuid: string;
  sourceServerNodeId: string;
  fastdlServerNodeId: string;
}): Promise<Pairing> {
  return api.post('/pairings', payload);
}

export async function deletePairing(id: string): Promise<void> {
  await api.delete(`/pairings/${id}`);
}

export async function triggerSync(id: string): Promise<void> {
  await api.post(`/pairings/${id}/sync`, {});
}

export async function fetchSyncLog(id: string): Promise<SyncRun[]> {
  const res = await api.get(`/pairings/${id}/log`);
  return res.log ?? [];
}

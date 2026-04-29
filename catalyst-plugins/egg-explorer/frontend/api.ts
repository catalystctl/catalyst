/**
 * Egg Explorer — Typed API Client
 *
 * Uses the Catalyst plugin SDK API client (`createPluginApi`) for typed,
 * error-handled communication with the plugin backend.
 */

import { createPluginApi } from '@/plugins/plugin-definition';
import { reportSystemError } from '@/services/api/systemErrors';
import type { EggSummary, EggCategory, EggIndexStatus, EggListResponse } from './types';

const api = createPluginApi('egg-explorer');
const API_BASE = import.meta.env.VITE_API_URL ?? '';

// ── Plugin backend endpoints ──

export async function fetchEggs(params?: {
  search?: string;
  category?: string;
  subcategory?: string;
  imageFamily?: string;
  feature?: string;
  page?: number;
  pageSize?: number;
}): Promise<EggListResponse> {
  const sp = new URLSearchParams();
  if (params?.search) sp.set('search', params.search);
  if (params?.category) sp.set('category', params.category);
  if (params?.subcategory) sp.set('subcategory', params.subcategory);
  if (params?.imageFamily) sp.set('imageFamily', params.imageFamily);
  if (params?.feature) sp.set('feature', params.feature);
  if (params?.page) sp.set('page', String(params.page));
  if (params?.pageSize) sp.set('pageSize', String(params.pageSize));

  const res = await api.get<EggListResponse>(`?${sp.toString()}`);
  if (!res.success) {
    reportSystemError({
      level: 'error',
      component: 'EggExplorerApi',
      message: res.error ?? 'Failed to fetch eggs',
      metadata: { context: 'fetchEggs' },
    });
    throw new Error(res.error ?? 'Failed to fetch eggs');
  }
  return res as unknown as EggListResponse;
}

export async function fetchCategories(): Promise<{
  data: EggCategory[];
  totalCategories: number;
  totalEggs: number;
}> {
  const res = await api.get<any>('categories');
  if (!res.success) {
    reportSystemError({
      level: 'error',
      component: 'EggExplorerApi',
      message: res.error ?? 'Failed to fetch categories',
      metadata: { context: 'fetchCategories' },
    });
    throw new Error(res.error ?? 'Failed to fetch categories');
  }
  return res as unknown as { data: EggCategory[]; totalCategories: number; totalEggs: number };
}

export async function fetchStatus(): Promise<EggIndexStatus> {
  const res = await api.get<EggIndexStatus>('status');
  if (!res.success || !res.data) {
    reportSystemError({
      level: 'error',
      component: 'EggExplorerApi',
      message: res.error ?? 'Failed to fetch status',
      metadata: { context: 'fetchStatus' },
    });
    throw new Error(res.error ?? 'Failed to fetch status');
  }
  return res.data;
}

export async function triggerSync(): Promise<void> {
  const res = await api.post<void>('sync');
  if (!res.success) {
    reportSystemError({
      level: 'error',
      component: 'EggExplorerApi',
      message: res.error ?? 'Failed to trigger sync',
      metadata: { context: 'triggerSync' },
    });
    throw new Error(res.error ?? 'Failed to trigger sync');
  }
}

export async function fetchFullEgg(filePath: string): Promise<any> {
  const res = await api.get<any>(`egg?path=${encodeURIComponent(filePath)}`);
  if (!res.success || !res.data) {
    reportSystemError({
      level: 'error',
      component: 'EggExplorerApi',
      message: res.error ?? 'Failed to fetch egg data',
      metadata: { context: 'fetchFullEgg' },
    });
    throw new Error(res.error ?? 'Failed to fetch egg data');
  }
  return res.data;
}

// ── Host endpoints (bypass plugin API — these are Catalyst core APIs) ──

export async function importEgg(eggData: Record<string, any>, nestId?: string) {
  const res = await fetch(`${API_BASE}/api/templates/import-pterodactyl`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...eggData, nestId }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    reportSystemError({
      level: 'error',
      component: 'EggExplorerApi',
      message: body.error || 'Import failed',
      metadata: { context: 'importEgg' },
    });
    throw new Error(body.error || 'Import failed');
  }

  return res.json();
}

export async function fetchNests(): Promise<Array<{ id: string; name: string }>> {
  const res = await fetch(`${API_BASE}/api/nests`, { credentials: 'include' });
  if (!res.ok) return [];
  const body = await res.json();
  return body.data ?? [];
}

import { useState, useEffect, useCallback } from 'react';
import {
  fetchCategories,
  fetchUsers,
  fetchServers,
  fetchStatuses,
  fetchTransitions,
  fetchStats,
} from '../api';
import type { Category, TicketUser, Server, Status, Tag, TicketTemplate, TicketStats } from '../types';

interface TicketingData {
  categories: Category[];
  users: TicketUser[];
  servers: Server[];
  statuses: Status[];
  transitions: Record<string, string[]>;
  stats: TicketStats;
  tags: Tag[];
  templates: TicketTemplate[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

/**
 * Shared data loading hook for the ticketing plugin.
 *
 * Loads reference data (categories, users, servers, statuses, etc.)
 * in parallel.  Individual endpoint failures are swallowed so the UI
 * can still render with whatever data *did* come back.  Only when
 * *every* request fails do we surface an error banner.
 *
 * Tags and Templates are **not** eagerly loaded — the backend doesn't
 * have those endpoints yet.  They are loaded on-demand when the user
 * opens the tag manager or template manager modal.
 */
export function useTicketingData(loadStats = true): TicketingData {
  const [categories, setCategories] = useState<Category[]>([]);
  const [users, setUsers] = useState<TicketUser[]>([]);
  const [servers, setServers] = useState<Server[]>([]);
  const [statuses, setStatuses] = useState<Status[]>([]);
  const [transitions, setTransitions] = useState<Record<string, string[]>>({});
  const [stats, setStats] = useState<TicketStats>({});
  const [tags, setTags] = useState<Tag[]>([]);
  const [templates, setTemplates] = useState<TicketTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // Fire all requests in parallel — none of them throw, they all
      // return { success, data?, error? } objects.
      const [
        catRes,
        usersRes,
        serversRes,
        statusesRes,
        transitionsRes,
        statsRes,
      ] = await Promise.all([
        fetchCategories(),
        fetchUsers(),
        fetchServers(),
        fetchStatuses(),
        fetchTransitions(),
        loadStats ? fetchStats() : Promise.resolve({ success: true, data: {} }),
      ]);

      // Core endpoints — apply data on success, leave defaults on failure
      if (catRes.success) setCategories(catRes.data ?? []);
      else console.warn('[ticketing-plugin] /categories failed:', catRes.error);

      if (usersRes.success) setUsers(usersRes.data ?? []);
      else console.warn('[ticketing-plugin] /users failed:', usersRes.error);

      if (serversRes.success) setServers(serversRes.data ?? []);
      else console.warn('[ticketing-plugin] /servers failed:', serversRes.error);

      if (statusesRes.success) setStatuses(statusesRes.data ?? []);
      else console.warn('[ticketing-plugin] /statuses failed:', statusesRes.error);

      if (transitionsRes.success) setTransitions(transitionsRes.data ?? {});
      else console.warn('[ticketing-plugin] /transitions failed:', transitionsRes.error);

      if (statsRes.success) setStats(statsRes.data ?? {});
      else console.warn('[ticketing-plugin] /stats failed:', statsRes.error);

      // Only show error if *every core* request failed
      const coreResults = [catRes, usersRes, serversRes, statusesRes, transitionsRes];
      const allCoreFailed = coreResults.every((r) => !r.success);
      if (allCoreFailed) {
        setError('Unable to connect to the ticketing service');
      }
    } catch (err) {
      // Shouldn't happen since apiFetch never throws, but just in case
      console.error('[ticketing-plugin] Unexpected error loading data:', err);
      setError('Failed to load ticketing data');
    }

    setLoading(false);
  }, [loadStats]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  return {
    categories,
    users,
    servers,
    statuses,
    transitions,
    stats,
    tags,
    templates,
    loading,
    error,
    refresh: loadData,
  };
}

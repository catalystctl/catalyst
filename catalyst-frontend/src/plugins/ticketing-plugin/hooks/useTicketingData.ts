// src/plugins/ticketing-plugin/hooks/useTicketingData.ts
// Central data-fetching hook for the ticketing plugin.
// Manages tickets, stats, comments, activities, tags, templates, users, servers, and settings.

import { useState, useEffect, useCallback } from 'react';
import type {
  Ticket,
  TicketComment,
  TicketActivity,
  TicketStats,
  TicketFilters,
  TicketSort,
  Tag,
  TicketTemplate,
  TicketingSettings,
  UserRef,
  ServerRef,
} from '../types';
import { DEFAULT_PAGE_SIZE } from '../constants';
import * as api from '../api';

export interface TicketingDataState {
  // Tickets
  tickets: Ticket[];
  ticketTotal: number;
  ticketPage: number;
  ticketPageSize: number;
  ticketTotalPages: number;
  isLoadingTickets: boolean;
  filters: TicketFilters;
  sort: TicketSort;

  // Detail
  selectedTicket: Ticket | null;
  selectedTicketComments: TicketComment[];
  selectedTicketActivities: TicketActivity[];
  isLoadingDetail: boolean;

  // Reference data
  stats: TicketStats | null;
  tags: Tag[];
  templates: TicketTemplate[];
  users: UserRef[];
  servers: ServerRef[];
  settings: TicketingSettings | null;
  isLoadingRefData: boolean;

  // Errors
  error: string | null;
}

export interface TicketingDataActions {
  // Tickets
  loadTickets: () => Promise<void>;
  setPage: (page: number) => void;
  setPageSize: (size: number) => void;
  setFilters: (filters: TicketFilters) => void;
  setSort: (sort: TicketSort) => void;

  // Detail
  selectTicket: (id: string | null) => void;
  refreshDetail: () => Promise<void>;

  // Reference data
  loadRefData: () => Promise<void>;
  refreshStats: () => Promise<void>;
  refreshTags: () => Promise<void>;
  refreshTemplates: () => Promise<void>;

  // Utility
  clearError: () => void;
}

const INITIAL_SORT: TicketSort = { field: 'updatedAt', direction: 'desc' };

export function useTicketingData(): TicketingDataState & TicketingDataActions {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [ticketTotal, setTicketTotal] = useState(0);
  const [ticketPage, setTicketPage] = useState(1);
  const [ticketPageSize, setTicketPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [ticketTotalPages, setTicketTotalPages] = useState(1);
  const [isLoadingTickets, setIsLoadingTickets] = useState(false);

  const [filters, setFiltersState] = useState<TicketFilters>({});
  const [sort, setSortState] = useState<TicketSort>(INITIAL_SORT);

  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [selectedTicketComments, setSelectedTicketComments] = useState<TicketComment[]>([]);
  const [selectedTicketActivities, setSelectedTicketActivities] = useState<TicketActivity[]>([]);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);

  const [stats, setStats] = useState<TicketStats | null>(null);
  const [tags, setTags] = useState<Tag[]>([]);
  const [templates, setTemplates] = useState<TicketTemplate[]>([]);
  const [users, setUsers] = useState<UserRef[]>([]);
  const [servers, setServers] = useState<ServerRef[]>([]);
  const [settings, setSettings] = useState<TicketingSettings | null>(null);
  const [isLoadingRefData, setIsLoadingRefData] = useState(false);

  const [error, setError] = useState<string | null>(null);

  // ── Load tickets ──
  const loadTickets = useCallback(async () => {
    setIsLoadingTickets(true);
    setError(null);
    try {
      const result = await api.fetchTickets(filters, sort, ticketPage, ticketPageSize);
      setTickets(result.data);
      setTicketTotal(result.total);
      setTicketTotalPages(result.totalPages);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load tickets';
      setError(msg);
    } finally {
      setIsLoadingTickets(false);
    }
  }, [filters, sort, ticketPage, ticketPageSize]);

  // ── Load reference data ──
  const loadRefData = useCallback(async () => {
    setIsLoadingRefData(true);
    setError(null);
    try {
      const [statsRes, tagsRes, templatesRes, usersRes, serversRes, settingsRes] = await Promise.allSettled([
        api.fetchStats(),
        api.fetchTags(),
        api.fetchTemplates(),
        api.fetchUsers(),
        api.fetchServers(),
        api.fetchSettings(),
      ]);
      if (statsRes.status === 'fulfilled') setStats(statsRes.value);
      if (tagsRes.status === 'fulfilled') setTags(tagsRes.value);
      if (templatesRes.status === 'fulfilled') setTemplates(templatesRes.value);
      if (usersRes.status === 'fulfilled') setUsers(usersRes.value);
      if (serversRes.status === 'fulfilled') setServers(serversRes.value);
      if (settingsRes.status === 'fulfilled') setSettings(settingsRes.value);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load reference data';
      setError(msg);
    } finally {
      setIsLoadingRefData(false);
    }
  }, []);

  // ── Select ticket (load detail) ──
  const selectTicket = useCallback((id: string | null) => {
    setSelectedTicketId(id);
    if (!id) {
      setSelectedTicket(null);
      setSelectedTicketComments([]);
      setSelectedTicketActivities([]);
      return;
    }
    // Detail loading happens in useEffect below
  }, []);

  // ── Load ticket detail ──
  const loadDetail = useCallback(async (id: string) => {
    setIsLoadingDetail(true);
    setError(null);
    try {
      const [ticket, comments, activities] = await Promise.all([
        api.fetchTicket(id),
        api.fetchComments(id),
        api.fetchActivities(id),
      ]);
      setSelectedTicket(ticket);
      setSelectedTicketComments(comments);
      setSelectedTicketActivities(activities.data || (Array.isArray(activities) ? activities : []));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load ticket detail';
      setError(msg);
    } finally {
      setIsLoadingDetail(false);
    }
  }, []);

  // Load detail when selectedTicketId changes
  useEffect(() => {
    if (selectedTicketId) {
      loadDetail(selectedTicketId);
    }
  }, [selectedTicketId, loadDetail]);

  // ── Individual refreshers ──
  const refreshStats = useCallback(async () => {
    try {
      const s = await api.fetchStats();
      setStats(s);
    } catch { /* silent */ }
  }, []);

  const refreshTags = useCallback(async () => {
    try {
      const t = await api.fetchTags();
      setTags(t);
    } catch { /* silent */ }
  }, []);

  const refreshTemplates = useCallback(async () => {
    try {
      const t = await api.fetchTemplates();
      setTemplates(t);
    } catch { /* silent */ }
  }, []);

  const refreshDetail = useCallback(async () => {
    if (selectedTicketId) {
      await loadDetail(selectedTicketId);
    }
  }, [selectedTicketId, loadDetail]);

  // ── Pagination & filter handlers ──
  const setPage = useCallback((page: number) => {
    setTicketPage(page);
  }, []);

  const setPageSize = useCallback((size: number) => {
    setTicketPageSize(size);
    setTicketPage(1);
  }, []);

  const setFilters = useCallback((newFilters: TicketFilters) => {
    setFiltersState(newFilters);
    setTicketPage(1); // Reset page on filter change
  }, []);

  const setSort = useCallback((newSort: TicketSort) => {
    setSortState(newSort);
  }, []);

  const clearError = useCallback(() => setError(null), []);

  // ── Load on mount ──
  useEffect(() => {
    loadTickets();
  }, [loadTickets]);

  useEffect(() => {
    loadRefData();
  }, [loadRefData]);

  return {
    tickets,
    ticketTotal,
    ticketPage,
    ticketPageSize,
    ticketTotalPages,
    isLoadingTickets,
    filters,
    sort,
    selectedTicket,
    selectedTicketComments,
    selectedTicketActivities,
    isLoadingDetail,
    stats,
    tags,
    templates,
    users,
    servers,
    settings,
    isLoadingRefData,
    error,
    loadTickets,
    setPage,
    setPageSize,
    setFilters,
    setSort,
    selectTicket,
    refreshDetail,
    loadRefData,
    refreshStats,
    refreshTags,
    refreshTemplates,
    clearError,
  };
}

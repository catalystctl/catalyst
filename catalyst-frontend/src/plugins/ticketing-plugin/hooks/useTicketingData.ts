// src/plugins/ticketing-plugin/hooks/useTicketingData.ts
// Central data-fetching hook for the ticketing plugin.
// Manages tickets, stats, comments, activities, tags, templates, users, servers, and settings.

import { useState, useCallback } from 'react';
import { useQuery, useQueries, useQueryClient } from '@tanstack/react-query';
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
  const queryClient = useQueryClient();
  const [filters, setFiltersState] = useState<TicketFilters>({});
  const [sort, setSortState] = useState<TicketSort>(INITIAL_SORT);
  const [ticketPage, setTicketPage] = useState(1);
  const [ticketPageSize, setTicketPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);

  // ── Tickets ──
  const ticketsQuery = useQuery({
    queryKey: ['ticketing', 'tickets', filters, sort, ticketPage, ticketPageSize],
    queryFn: () => api.fetchTickets(filters, sort, ticketPage, ticketPageSize),
    staleTime: 30_000,
  });

  const tickets = ticketsQuery.data?.data ?? [];
  const ticketTotal = ticketsQuery.data?.total ?? 0;
  const ticketTotalPages = ticketsQuery.data?.totalPages ?? 1;
  const isLoadingTickets = ticketsQuery.isLoading;
  const ticketsError = ticketsQuery.error;

  // ── Detail ──
  const detailQueries = useQueries({
    queries: [
      { queryKey: ['ticketing', 'ticket', selectedTicketId ?? ''], queryFn: () => api.fetchTicket(selectedTicketId ?? ''), enabled: !!selectedTicketId },
      { queryKey: ['ticketing', 'comments', selectedTicketId ?? ''], queryFn: () => api.fetchComments(selectedTicketId ?? ''), enabled: !!selectedTicketId },
      { queryKey: ['ticketing', 'activities', selectedTicketId ?? ''], queryFn: () => api.fetchActivities(selectedTicketId ?? ''), enabled: !!selectedTicketId },
    ],
  });

  const selectedTicket = (detailQueries[0]?.data as Ticket | undefined) ?? null;
  const selectedTicketComments = (detailQueries[1]?.data ?? []) as TicketComment[];
  const selectedTicketActivities = (() => {
    const acts = detailQueries[2]?.data;
    if (!acts) return [];
    return (acts as any).data ?? (Array.isArray(acts) ? acts : []);
  })();
  const isLoadingDetail = detailQueries.some((q) => q.isLoading);

  // ── Ref Data ──
  const statsQuery = useQuery({ queryKey: ['ticketing', 'ref', 'stats'], queryFn: () => api.fetchStats(), staleTime: 60_000 });
  const tagsQuery = useQuery({ queryKey: ['ticketing', 'ref', 'tags'], queryFn: api.fetchTags, staleTime: 60_000 });
  const templatesQuery = useQuery({ queryKey: ['ticketing', 'ref', 'templates'], queryFn: api.fetchTemplates, staleTime: 60_000 });
  const usersQuery = useQuery({ queryKey: ['ticketing', 'ref', 'users'], queryFn: api.fetchUsers, staleTime: 60_000 });
  const serversQuery = useQuery({ queryKey: ['ticketing', 'ref', 'servers'], queryFn: api.fetchServers, staleTime: 60_000 });
  const settingsQuery = useQuery({ queryKey: ['ticketing', 'ref', 'settings'], queryFn: api.fetchSettings, staleTime: 60_000 });

  const isLoadingRefData = [statsQuery, tagsQuery, templatesQuery, usersQuery, serversQuery, settingsQuery].some((q) => q.isLoading);

  // Combine errors into a single string for consumers
  const error = (() => {
    if (ticketsError) {
      return ticketsError instanceof Error ? ticketsError.message : 'Failed to load tickets';
    }
    const refErrors = [statsQuery, tagsQuery, templatesQuery, usersQuery, serversQuery, settingsQuery].filter((q) => q.error);
    if (refErrors.length > 0) {
      const first = refErrors[0].error;
      return first instanceof Error ? first.message : 'Failed to load reference data';
    }
    return null;
  })();

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
    setTicketPage(1);
  }, []);

  const setSort = useCallback((newSort: TicketSort) => {
    setSortState(newSort);
  }, []);

  const selectTicket = useCallback((id: string | null) => {
    setSelectedTicketId(id);
  }, []);

  const loadTickets = useCallback(async () => {
    await ticketsQuery.refetch();
  }, [ticketsQuery]);

  const refreshDetail = useCallback(async () => {
    if (selectedTicketId) {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['ticketing', 'ticket', selectedTicketId] }),
        queryClient.invalidateQueries({ queryKey: ['ticketing', 'comments', selectedTicketId] }),
        queryClient.invalidateQueries({ queryKey: ['ticketing', 'activities', selectedTicketId] }),
      ]);
    }
  }, [selectedTicketId, queryClient]);

  const loadRefData = useCallback(async () => {
    await Promise.all([
      statsQuery.refetch(),
      tagsQuery.refetch(),
      templatesQuery.refetch(),
      usersQuery.refetch(),
      serversQuery.refetch(),
      settingsQuery.refetch(),
    ]);
  }, [statsQuery, tagsQuery, templatesQuery, usersQuery, serversQuery, settingsQuery]);

  const refreshStats = useCallback(async () => {
    await statsQuery.refetch();
  }, [statsQuery]);

  const refreshTags = useCallback(async () => {
    await tagsQuery.refetch();
  }, [tagsQuery]);

  const refreshTemplates = useCallback(async () => {
    await templatesQuery.refetch();
  }, [templatesQuery]);

  const clearError = useCallback(() => {
    queryClient.removeQueries({ queryKey: ['ticketing', 'tickets'] });
    queryClient.removeQueries({ queryKey: ['ticketing', 'ref'] });
  }, [queryClient]);

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
    stats: statsQuery.data ?? null,
    tags: tagsQuery.data ?? [],
    templates: templatesQuery.data ?? [],
    users: usersQuery.data ?? [],
    servers: serversQuery.data ?? [],
    settings: settingsQuery.data ?? null,
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

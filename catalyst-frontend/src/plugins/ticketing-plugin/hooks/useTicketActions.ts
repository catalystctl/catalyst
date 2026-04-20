import { useState, useCallback } from 'react';
import {
  fetchTickets,
  fetchTicket,
  createTicket,
  updateTicket,
  deleteTicket as apiDeleteTicket,
  mergeTickets as apiMergeTickets,
  addComment,
  deleteComment as apiDeleteComment,
  editComment as apiEditComment,
  pinComment as apiPinComment,
  fetchActivities,
  fetchAttachments,
  uploadAttachment,
  deleteAttachment as apiDeleteAttachment,
  linkTicket as apiLinkTicket,
  unlinkTicket as apiUnlinkTicket,
  triggerCsvExport,
  triggerPrintExport,
} from '../api';
import type {
  Ticket,
  Comment,
  Activity,
  Attachment,
  LinkedTicket,
  FilterState,
  PaginationState,
  LinkType,
  TicketListParams,
} from '../types';
import { DEFAULT_FILTERS, PAGE_SIZES } from '../constants';

interface TicketActionsReturn {
  // Ticket list
  tickets: Ticket[];
  pagination: PaginationState;
  loading: boolean;
  loadTickets: (params?: Partial<TicketListParams>) => Promise<void>;

  // Ticket detail
  selectedTicket: Ticket | null;
  ticketComments: Comment[];
  ticketActivities: Activity[];
  ticketAttachments: Attachment[];
  ticketLinkedTickets: LinkedTicket[];
  loadTicketDetail: (id: string) => Promise<void>;
  clearSelection: () => void;

  // CRUD
  createNewTicket: (data: Record<string, any>) => Promise<Ticket | null>;
  updateTicketProp: (id: string, data: Record<string, any>) => Promise<void>;
  removeTicket: (id: string) => Promise<void>;
  mergeTickets: (primaryId: string, sourceIds: string[]) => Promise<void>;

  // Comments
  addNewComment: (ticketId: string, content: string, isInternal: boolean, statusChange?: string) => Promise<void>;
  removeComment: (ticketId: string, commentId: string) => Promise<void>;
  editComment: (ticketId: string, commentId: string, content: string) => Promise<void>;
  togglePinComment: (ticketId: string, commentId: string) => Promise<void>;

  // Attachments
  uploadNewAttachment: (ticketId: string, file: File) => Promise<void>;
  removeAttachment: (ticketId: string, attachmentId: string) => Promise<void>;

  // Links
  linkNewTicket: (ticketId: string, targetId: string, type: LinkType) => Promise<void>;
  unlinkTicket: (ticketId: string, targetId: string) => Promise<void>;

  // Export
  exportCsv: () => void;
  exportPdf: () => void;

  // Filters
  filters: FilterState;
  setFilters: React.Dispatch<React.SetStateAction<FilterState>>;
  sortBy: string;
  setSortBy: (sort: string) => void;
  updateFilter: (key: keyof FilterState, value: string | string[]) => void;
  clearFilters: () => void;
  hasActiveFilters: boolean;

  // Pagination
  setPage: (page: number) => void;
  setPageSize: (size: number) => void;
}

export function useTicketActions(): TicketActionsReturn {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [pagination, setPagination] = useState<PaginationState>({
    page: 1,
    pageSize: 25,
    total: 0,
  });
  const [loading, setLoading] = useState(false);

  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [ticketComments, setTicketComments] = useState<Comment[]>([]);
  const [ticketActivities, setTicketActivities] = useState<Activity[]>([]);
  const [ticketAttachments, setTicketAttachments] = useState<Attachment[]>([]);
  const [ticketLinkedTickets, setTicketLinkedTickets] = useState<LinkedTicket[]>([]);

  const [filters, setFilters] = useState<FilterState>({ ...DEFAULT_FILTERS });
  const [sortBy, setSortBy] = useState('newest');

  // ─── Ticket List ─────────────────────────────────────────

  const loadTickets = useCallback(async (overrideParams?: Partial<TicketListParams>) => {
    setLoading(true);
    try {
      const params: TicketListParams = {
        filters: overrideParams?.filters || filters,
        sort: overrideParams?.sort || sortBy,
        pagination: overrideParams?.pagination || { page: pagination.page, pageSize: pagination.pageSize },
      };
      const res = await fetchTickets(params);
      if (res.success) {
        setTickets(res.data || []);
        setPagination((prev) => ({
          ...prev,
          total: res.total || 0,
          page: res.page || prev.page,
          pageSize: res.pageSize || prev.pageSize,
        }));
      }
    } catch (err) {
      console.error('Failed to load tickets:', err);
    }
    setLoading(false);
  }, [filters, sortBy, pagination.page, pagination.pageSize]);

  // ─── Ticket Detail ───────────────────────────────────────

  const loadTicketDetail = useCallback(async (id: string) => {
    try {
      const res = await fetchTicket(id);
      if (res.success && res.data) {
        setSelectedTicket(res.data);
        setTicketComments(res.data.comments || []);
        setTicketAttachments(res.data.attachments || []);
        setTicketLinkedTickets(res.data.linkedTickets || []);
      }
      // Load activities in parallel (optional — backend may not support it yet)
      const actRes = await fetchActivities(id);
      if (actRes.success) {
        setTicketActivities(actRes.data || []);
      } else if (!actRes.error?.includes('404')) {
        console.warn('[ticketing-plugin] /activities failed:', actRes.error);
      }
    } catch (err) {
      console.error('Failed to load ticket:', err);
    }
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedTicket(null);
    setTicketComments([]);
    setTicketActivities([]);
    setTicketAttachments([]);
    setTicketLinkedTickets([]);
  }, []);

  // ─── CRUD ────────────────────────────────────────────────

  const createNewTicket = useCallback(async (data: Record<string, any>): Promise<Ticket | null> => {
    try {
      const res = await createTicket(data);
      if (res.success && res.data) {
        loadTickets();
        return res.data;
      }
      return null;
    } catch {
      return null;
    }
  }, [loadTickets]);

  const updateTicketProp = useCallback(async (id: string, data: Record<string, any>) => {
    try {
      await updateTicket(id, data);
      if (selectedTicket?.id === id) {
        loadTicketDetail(id);
      }
      loadTickets();
    } catch (err) {
      console.error('Failed to update ticket:', err);
    }
  }, [selectedTicket, loadTicketDetail, loadTickets]);

  const removeTicket = useCallback(async (id: string) => {
    if (!confirm('Delete this ticket? This cannot be undone.')) return;
    try {
      await apiDeleteTicket(id);
      if (selectedTicket?.id === id) {
        clearSelection();
      }
      loadTickets();
    } catch (err) {
      console.error('Failed to delete ticket:', err);
    }
  }, [selectedTicket, clearSelection, loadTickets]);

  const mergeTickets = useCallback(async (primaryId: string, sourceIds: string[]) => {
    try {
      await apiMergeTickets(primaryId, sourceIds);
      clearSelection();
      loadTickets();
    } catch (err) {
      console.error('Failed to merge tickets:', err);
    }
  }, [clearSelection, loadTickets]);

  // ─── Comments ────────────────────────────────────────────

  const addNewComment = useCallback(async (ticketId: string, content: string, isInternal: boolean, statusChange?: string) => {
    try {
      await addComment(ticketId, { content, isInternal, statusChange });
      if (selectedTicket?.id === ticketId) {
        loadTicketDetail(ticketId);
      }
      loadTickets();
    } catch (err) {
      console.error('Failed to add comment:', err);
    }
  }, [selectedTicket, loadTicketDetail, loadTickets]);

  const removeComment = useCallback(async (ticketId: string, commentId: string) => {
    try {
      await apiDeleteComment(ticketId, commentId);
      if (selectedTicket?.id === ticketId) {
        loadTicketDetail(ticketId);
      }
    } catch (err) {
      console.error('Failed to delete comment:', err);
    }
  }, [selectedTicket, loadTicketDetail]);

  const editComment = useCallback(async (ticketId: string, commentId: string, content: string) => {
    try {
      await apiEditComment(ticketId, commentId, content);
      if (selectedTicket?.id === ticketId) {
        loadTicketDetail(ticketId);
      }
    } catch (err) {
      console.error('Failed to edit comment:', err);
    }
  }, [selectedTicket, loadTicketDetail]);

  const togglePinComment = useCallback(async (ticketId: string, commentId: string) => {
    try {
      await apiPinComment(ticketId, commentId);
      if (selectedTicket?.id === ticketId) {
        loadTicketDetail(ticketId);
      }
    } catch (err) {
      console.error('Failed to pin comment:', err);
    }
  }, [selectedTicket, loadTicketDetail]);

  // ─── Attachments ─────────────────────────────────────────

  const uploadNewAttachment = useCallback(async (ticketId: string, file: File) => {
    try {
      await uploadAttachment(ticketId, file);
      if (selectedTicket?.id === ticketId) {
        loadTicketDetail(ticketId);
      }
      loadTickets();
    } catch (err) {
      console.error('Failed to upload attachment:', err);
    }
  }, [selectedTicket, loadTicketDetail, loadTickets]);

  const removeAttachment = useCallback(async (ticketId: string, attachmentId: string) => {
    try {
      await apiDeleteAttachment(ticketId, attachmentId);
      if (selectedTicket?.id === ticketId) {
        loadTicketDetail(ticketId);
      }
    } catch (err) {
      console.error('Failed to delete attachment:', err);
    }
  }, [selectedTicket, loadTicketDetail]);

  // ─── Links ───────────────────────────────────────────────

  const linkNewTicket = useCallback(async (ticketId: string, targetId: string, type: LinkType) => {
    try {
      await apiLinkTicket(ticketId, targetId, type);
      if (selectedTicket?.id === ticketId) {
        loadTicketDetail(ticketId);
      }
    } catch (err) {
      console.error('Failed to link ticket:', err);
    }
  }, [selectedTicket, loadTicketDetail]);

  const unlinkTicket = useCallback(async (ticketId: string, targetId: string) => {
    try {
      await apiUnlinkTicket(ticketId, targetId);
      if (selectedTicket?.id === ticketId) {
        loadTicketDetail(ticketId);
      }
    } catch (err) {
      console.error('Failed to unlink ticket:', err);
    }
  }, [selectedTicket, loadTicketDetail]);

  // ─── Export ──────────────────────────────────────────────

  const exportCsv = useCallback(() => {
    triggerCsvExport({ filters, sort: sortBy });
  }, [filters, sortBy]);

  const exportPdf = useCallback(() => {
    triggerPrintExport();
  }, []);

  // ─── Filters ─────────────────────────────────────────────

  const updateFilter = useCallback((key: keyof FilterState, value: string | string[]) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPagination((prev) => ({ ...prev, page: 1 }));
  }, []);

  const clearFilters = useCallback(() => {
    setFilters({ ...DEFAULT_FILTERS });
    setPagination((prev) => ({ ...prev, page: 1 }));
  }, []);

  const hasActiveFilters =
    !!filters.search ||
    !!filters.status ||
    !!filters.priority ||
    !!filters.category ||
    !!filters.assignedTo ||
    !!filters.createdBy ||
    !!filters.dateFrom ||
    !!filters.dateTo ||
    filters.tags.length > 0;

  // ─── Pagination ──────────────────────────────────────────

  const setPage = useCallback((page: number) => {
    setPagination((prev) => ({ ...prev, page }));
  }, []);

  const setPageSize = useCallback((pageSize: number) => {
    setPagination((prev) => ({ ...prev, page: 1, pageSize }));
  }, []);

  return {
    tickets,
    pagination,
    loading,
    loadTickets,
    selectedTicket,
    ticketComments,
    ticketActivities,
    ticketAttachments,
    ticketLinkedTickets,
    loadTicketDetail,
    clearSelection,
    createNewTicket,
    updateTicketProp,
    removeTicket,
    mergeTickets,
    addNewComment,
    removeComment,
    editComment,
    togglePinComment,
    uploadNewAttachment,
    removeAttachment,
    linkNewTicket,
    unlinkTicket,
    exportCsv,
    exportPdf,
    filters,
    setFilters,
    sortBy,
    setSortBy,
    updateFilter,
    clearFilters,
    hasActiveFilters,
    setPage,
    setPageSize,
  };
}

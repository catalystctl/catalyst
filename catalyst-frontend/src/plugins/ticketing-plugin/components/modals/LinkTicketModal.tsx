import React, { useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, X, Link2, Search } from 'lucide-react';
import { motion } from 'framer-motion';
import { modalVariants, fadeInVariants, LINK_TYPE_CONFIG } from '../../constants';
import type { LinkType } from '../../types';
import { FieldLabel } from '../shared/FieldLabel';
import { IconBox } from '../shared/IconBox';
import { StatusBadge } from '../shared/StatusBadge';
import { PriorityDot } from '../shared/PriorityDot';
import { PRIORITY_CONFIG } from '../../constants';
import * as apiClient from '../../api';

interface LinkTicketModalProps {
  open: boolean;
  onClose: () => void;
  currentTicketId: string;
  onLinked: () => void;
}

export function LinkTicketModal({ open, onClose, currentTicketId, onLinked }: LinkTicketModalProps) {
  const [ticketIdOrSearch, setTicketIdOrSearch] = useState('');
  const [linkType, setLinkType] = useState<LinkType>('related');
  const [results, setResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState('');

  const handleSearch = async () => {
    if (!ticketIdOrSearch.trim()) return;
    setSearching(true);
    setError('');
    try {
      const res = await apiClient.fetchTickets({
        filters: { search: ticketIdOrSearch.trim() },
        pagination: { page: 1, pageSize: 10 },
      });
      if (res.success) {
        setResults((res.data || []).filter((t: any) => t.id !== currentTicketId));
      }
    } catch {
      setError('Failed to search tickets');
    }
    setSearching(false);
  };

  const handleLink = async (targetId: string) => {
    setLinking(true);
    setError('');
    try {
      const res = await apiClient.linkTicket(currentTicketId, targetId, linkType);
      if (res.success) {
        onLinked();
        handleClose();
      } else {
        setError(res.error || 'Failed to link ticket');
      }
    } catch {
      setError('Failed to link ticket');
    }
    setLinking(false);
  };

  const handleClose = () => {
    setTicketIdOrSearch('');
    setResults([]);
    setError('');
    onClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <motion.div
        variants={fadeInVariants}
        initial="hidden"
        animate="visible"
        exit="exit"
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={handleClose}
      />
      <motion.div
        variants={modalVariants}
        initial="hidden"
        animate="visible"
        exit="exit"
        className="relative z-10 w-full max-w-lg rounded-xl border border-border bg-card p-6 shadow-elevated dark:shadow-elevated-dark"
      >
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <IconBox color="info">
              <Link2 className="h-4 w-4 text-info" />
            </IconBox>
            <div>
              <h2 className="font-display text-lg font-semibold text-foreground">Link Ticket</h2>
              <p className="text-xs text-muted-foreground">Connect this ticket to another</p>
            </div>
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {error && (
          <div className="mb-3 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </div>
        )}

        <div className="space-y-3">
          {/* Link type */}
          <div>
            <FieldLabel>Relationship Type</FieldLabel>
            <div className="mt-1.5 flex gap-2">
              {Object.entries(LINK_TYPE_CONFIG).map(([type, cfg]) => (
                <button
                  key={type}
                  onClick={() => setLinkType(type as LinkType)}
                  className={cn(
                    'flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors',
                    linkType === type
                      ? 'border-primary bg-primary/5 text-primary'
                      : 'border-border text-muted-foreground hover:bg-surface-2'
                  )}
                >
                  <cfg.icon className="h-3.5 w-3.5" />
                  {cfg.label}
                </button>
              ))}
            </div>
          </div>

          {/* Search */}
          <div>
            <FieldLabel>Search Tickets</FieldLabel>
            <div className="mt-1.5 flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={ticketIdOrSearch}
                  onChange={(e) => setTicketIdOrSearch(e.target.value)}
                  placeholder="Search by subject or ID..."
                  className="pl-8 h-8 text-sm"
                  onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                />
              </div>
              <Button size="sm" onClick={handleSearch} disabled={searching}>
                {searching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
                Search
              </Button>
            </div>
          </div>

          {/* Results */}
          {results.length > 0 && (
            <div className="max-h-48 space-y-1.5 overflow-y-auto">
              {results.map((ticket: any) => (
                <div
                  key={ticket.id}
                  className="flex items-center gap-3 rounded-lg border border-border p-2.5 hover:bg-surface-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">{ticket.subject}</p>
                    <p className="text-xs text-muted-foreground">#{ticket.id.slice(0, 8)}</p>
                  </div>
                  <StatusBadge status={ticket.status} />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleLink(ticket.id)}
                    disabled={linking}
                    className="h-7 gap-1 text-xs"
                  >
                    {linking ? <Loader2 className="h-3 w-3 animate-spin" /> : <Link2 className="h-3 w-3" />}
                    Link
                  </Button>
                </div>
              ))}
            </div>
          )}

          {results.length === 0 && ticketIdOrSearch && !searching && (
            <p className="py-2 text-center text-xs text-muted-foreground">No results found</p>
          )}
        </div>

        <div className="mt-4 flex justify-end border-t border-border pt-3">
          <Button variant="ghost" onClick={handleClose}>Cancel</Button>
        </div>
      </motion.div>
    </div>
  );
}

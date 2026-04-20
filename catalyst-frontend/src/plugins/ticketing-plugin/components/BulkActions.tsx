import React, { useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  MoreHorizontal,
  ArrowRightLeft,
  Flag,
  UserCheck,
  Trash2,
  GitMerge,
  CheckSquare,
  Square,
} from 'lucide-react';
import { STATUS_CONFIG, PRIORITY_CONFIG } from '../constants';
import type { TicketUser } from '../types';

interface BulkActionsProps {
  selectedIds: string[];
  totalCount: number;
  users: TicketUser[];
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onBulkStatusChange: (status: string) => void;
  onBulkPriorityChange: (priority: string) => void;
  onBulkAssign: (userId: string) => void;
  onBulkDelete: () => void;
  onMerge: () => void;
}

export function BulkActions({
  selectedIds,
  totalCount,
  users,
  onSelectAll,
  onDeselectAll,
  onBulkStatusChange,
  onBulkPriorityChange,
  onBulkAssign,
  onBulkDelete,
  onMerge,
}: BulkActionsProps) {
  const isAllSelected = selectedIds.length === totalCount && totalCount > 0;

  if (selectedIds.length === 0) {
    return (
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs" onClick={onSelectAll}>
          <CheckSquare className="h-3.5 w-3.5" />
          Select all
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Badge variant="secondary" className="gap-1">
        {selectedIds.length} selected
      </Badge>

      <Button
        variant="ghost"
        size="sm"
        className="h-7 gap-1.5 text-xs"
        onClick={isAllSelected ? onDeselectAll : onSelectAll}
      >
        {isAllSelected ? <Square className="h-3.5 w-3.5" /> : <CheckSquare className="h-3.5 w-3.5" />}
        {isAllSelected ? 'Deselect all' : 'Select all'}
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs">
            <MoreHorizontal className="h-3.5 w-3.5" />
            Actions
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-48">
          <DropdownMenuLabel>Change Status</DropdownMenuLabel>
          {Object.entries(STATUS_CONFIG).map(([key, cfg]) => (
            <DropdownMenuItem key={key} onClick={() => onBulkStatusChange(key)} className="text-xs">
              <cfg.icon className="mr-2 h-3.5 w-3.5" />
              {cfg.label}
            </DropdownMenuItem>
          ))}

          <DropdownMenuSeparator />
          <DropdownMenuLabel>Change Priority</DropdownMenuLabel>
          {Object.entries(PRIORITY_CONFIG).map(([key, cfg]) => (
            <DropdownMenuItem key={key} onClick={() => onBulkPriorityChange(key)} className="text-xs">
              <span className={cn('mr-2 h-2.5 w-2.5 rounded-full', cfg.dot)} />
              {cfg.label}
            </DropdownMenuItem>
          ))}

          <DropdownMenuSeparator />
          <DropdownMenuLabel>Assign To</DropdownMenuLabel>
          <DropdownMenuItem onClick={() => onBulkAssign('')} className="text-xs">
            <UserCheck className="mr-2 h-3.5 w-3.5" />
            Unassign
          </DropdownMenuItem>
          {users.map((user) => (
            <DropdownMenuItem key={user.id} onClick={() => onBulkAssign(user.id)} className="text-xs">
              <UserCheck className="mr-2 h-3.5 w-3.5" />
              {user.username || user.email}
            </DropdownMenuItem>
          ))}

          {selectedIds.length >= 2 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onMerge} className="text-xs">
                <GitMerge className="mr-2 h-3.5 w-3.5" />
                Merge Tickets
              </DropdownMenuItem>
            </>
          )}

          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onBulkDelete} className="text-xs text-danger focus:text-danger">
            <Trash2 className="mr-2 h-3.5 w-3.5" />
            Delete Selected
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

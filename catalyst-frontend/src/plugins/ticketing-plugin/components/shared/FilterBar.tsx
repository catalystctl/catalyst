import React from 'react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Search, X, Filter, SlidersHorizontal } from 'lucide-react';
import { STATUS_CONFIG, PRIORITY_CONFIG, SORT_OPTIONS } from '../../constants';
import type { FilterState, Category, TicketUser } from '../../types';

interface FilterBarProps {
  filters: FilterState;
  sortBy: string;
  categories: Category[];
  users: TicketUser[];
  tags: { id: string; name: string; color: string }[];
  showCategoryFilter?: boolean;
  showAssigneeFilter?: boolean;
  showCreatorFilter?: boolean;
  showDateFilter?: boolean;
  showTagFilter?: boolean;
  onFilterChange: (key: keyof FilterState, value: string | string[]) => void;
  onSortChange: (sort: string) => void;
  onClearFilters: () => void;
  hasActiveFilters: boolean;
  compact?: boolean;
}

export function FilterBar({
  filters,
  sortBy,
  categories,
  users,
  tags,
  showCategoryFilter = true,
  showAssigneeFilter = true,
  showCreatorFilter = false,
  showDateFilter = false,
  showTagFilter = false,
  onFilterChange,
  onSortChange,
  onClearFilters,
  hasActiveFilters,
  compact = false,
}: FilterBarProps) {
  const [showAdvanced, setShowAdvanced] = React.useState(false);

  const activeFilterChips: { key: keyof FilterState; label: string; value: string }[] = [];

  if (filters.status) {
    activeFilterChips.push({ key: 'status', label: 'Status', value: STATUS_CONFIG[filters.status]?.label || filters.status });
  }
  if (filters.priority) {
    activeFilterChips.push({ key: 'priority', label: 'Priority', value: PRIORITY_CONFIG[filters.priority]?.label || filters.priority });
  }
  if (filters.category) {
    const cat = categories.find((c) => c.id === filters.category);
    if (cat) activeFilterChips.push({ key: 'category', label: 'Category', value: cat.name });
  }
  if (filters.assignedTo) {
    const user = users.find((u) => u.id === filters.assignedTo);
    if (user) activeFilterChips.push({ key: 'assignedTo', label: 'Assigned', value: user.username || user.email || 'Unknown' });
  }
  if (filters.createdBy) {
    const user = users.find((u) => u.id === filters.createdBy);
    if (user) activeFilterChips.push({ key: 'createdBy', label: 'Creator', value: user.username || user.email || 'Unknown' });
  }
  if (filters.tags.length > 0) {
    filters.tags.forEach((tagId) => {
      const tag = tags.find((t) => t.id === tagId);
      if (tag) activeFilterChips.push({ key: 'tags', label: 'Tag', value: tag.name });
    });
  }

  const removeChip = (key: keyof FilterState, value: string) => {
    if (key === 'tags') {
      onFilterChange('tags', filters.tags.filter((t) => t !== value));
    } else {
      onFilterChange(key, '');
    }
  };

  return (
    <div className="space-y-2">
      <Card className="overflow-hidden">
        <CardContent className={cn('p-3', compact && 'p-2')}>
          <div className="flex flex-wrap items-center gap-2">
            {/* Search */}
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={filters.search}
                onChange={(e) => onFilterChange('search', e.target.value)}
                placeholder="Search tickets..."
                className="pl-8 h-8"
              />
            </div>

            {/* Status */}
            <select
              value={filters.status}
              onChange={(e) => onFilterChange('status', e.target.value)}
              className="h-8 rounded-lg border border-border bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <option value="">All Statuses</option>
              {Object.entries(STATUS_CONFIG).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>

            {/* Priority */}
            <select
              value={filters.priority}
              onChange={(e) => onFilterChange('priority', e.target.value)}
              className="h-8 rounded-lg border border-border bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <option value="">All Priorities</option>
              {Object.entries(PRIORITY_CONFIG).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>

            {/* Sort */}
            <select
              value={sortBy}
              onChange={(e) => onSortChange(e.target.value)}
              className="h-8 rounded-lg border border-border bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              {SORT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>

            {/* Advanced toggle */}
            <Button
              variant="ghost"
              size="sm"
              className={cn('h-8 gap-1.5 text-xs', showAdvanced && 'bg-surface-2')}
              onClick={() => setShowAdvanced(!showAdvanced)}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Filters
            </Button>

            {hasActiveFilters && (
              <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={onClearFilters}>
                Clear all
              </Button>
            )}
          </div>

          {/* Advanced filters */}
          {showAdvanced && (
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
              {showCategoryFilter && (
                <select
                  value={filters.category}
                  onChange={(e) => onFilterChange('category', e.target.value)}
                  className="h-8 rounded-lg border border-border bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  <option value="">All Categories</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              )}

              {showAssigneeFilter && (
                <select
                  value={filters.assignedTo}
                  onChange={(e) => onFilterChange('assignedTo', e.target.value)}
                  className="h-8 rounded-lg border border-border bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  <option value="">All Assignees</option>
                  <option value="__unassigned__">Unassigned</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>{u.username || u.email || 'Unknown'}</option>
                  ))}
                </select>
              )}

              {showCreatorFilter && (
                <select
                  value={filters.createdBy}
                  onChange={(e) => onFilterChange('createdBy', e.target.value)}
                  className="h-8 rounded-lg border border-border bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  <option value="">All Creators</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>{u.username || u.email || 'Unknown'}</option>
                  ))}
                </select>
              )}

              {showDateFilter && (
                <>
                  <input
                    type="date"
                    value={filters.dateFrom}
                    onChange={(e) => onFilterChange('dateFrom', e.target.value)}
                    className="h-8 rounded-lg border border-border bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                    title="From date"
                  />
                  <input
                    type="date"
                    value={filters.dateTo}
                    onChange={(e) => onFilterChange('dateTo', e.target.value)}
                    className="h-8 rounded-lg border border-border bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                    title="To date"
                  />
                </>
              )}

              {showTagFilter && tags.length > 0 && (
                <select
                  value=""
                  onChange={(e) => {
                    if (e.target.value && !filters.tags.includes(e.target.value)) {
                      onFilterChange('tags', [...filters.tags, e.target.value]);
                    }
                  }}
                  className="h-8 rounded-lg border border-border bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  <option value="">+ Add Tag Filter</option>
                  {tags
                    .filter((t) => !filters.tags.includes(t.id))
                    .map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                </select>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Active filter chips */}
      {activeFilterChips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 px-1">
          {activeFilterChips.map((chip, i) => (
            <Badge
              key={`${chip.key}-${chip.value}-${i}`}
              variant="secondary"
              className="gap-1 pr-1 text-xs cursor-default"
            >
              <span className="text-muted-foreground">{chip.label}:</span> {chip.value}
              <button
                onClick={() => removeChip(chip.key, chip.value)}
                className="ml-0.5 rounded-full p-0.5 hover:bg-surface-3 transition-colors"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

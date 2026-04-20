import React from 'react';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  TrendingUp,
  Clock,
  CheckCircle2,
  AlertCircle,
  Activity,
  BarChart3,
  ArrowUpRight,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { itemVariants, timeAgo, getUserDisplayName, ACTIVITY_CONFIG } from '../../constants';
import type { TicketStats, Activity as ActivityType, TicketUser, Category } from '../../types';
import { StatsCard } from '@/components/ui/stats-card';
import { StatusBadge } from '../shared/StatusBadge';

interface AdminDashboardProps {
  stats: TicketStats;
  users: TicketUser[];
  categories: Category[];
  onMyTicketsClick?: () => void;
}

export function AdminDashboard({ stats, users, categories, onMyTicketsClick }: AdminDashboardProps) {
  const recentActivity = stats.recentActivity || [];
  const volumeTrend = stats.volumeTrend || [];

  // Compute sparkline SVG
  const maxVal = Math.max(...volumeTrend, 1);
  const sparklinePoints = volumeTrend
    .map((v, i) => {
      const x = (i / Math.max(volumeTrend.length - 1, 1)) * 120;
      const y = 24 - (v / maxVal) * 20;
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <div className="space-y-4">
      {/* Primary stats */}
      <motion.div variants={itemVariants} className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatsCard
          title="Open"
          value={stats.open ?? 0}
          subtitle="Needs attention"
          icon={<AlertCircle className="h-4 w-4" />}
          variant="info"
        />
        <StatsCard
          title="In Progress"
          value={stats.in_progress ?? 0}
          subtitle="Being worked on"
          icon={<Clock className="h-4 w-4" />}
          variant="warning"
        />
        <StatsCard
          title="Resolved"
          value={stats.resolved ?? 0}
          subtitle="Awaiting closure"
          icon={<CheckCircle2 className="h-4 w-4" />}
          variant="success"
        />
        <StatsCard
          title="Critical"
          value={stats.critical ?? 0}
          subtitle={stats.critical > 0 ? 'Requires immediate action' : 'No critical issues'}
          icon={<AlertCircle className="h-4 w-4" />}
          variant={stats.critical > 0 ? 'danger' : 'default'}
        />
      </motion.div>

      {/* Secondary stats row */}
      <motion.div variants={itemVariants} className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {/* Created this week */}
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <TrendingUp className="h-3.5 w-3.5" />
              Created This Week
            </div>
            <p className="text-2xl font-bold text-foreground">{stats.createdThisWeek ?? '—'}</p>
          </CardContent>
        </Card>

        {/* Avg resolution time */}
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <Clock className="h-3.5 w-3.5" />
              Avg. Resolution
            </div>
            <p className="text-2xl font-bold text-foreground">
              {stats.avgResolutionTime
                ? stats.avgResolutionTime < 60
                  ? `${Math.round(stats.avgResolutionTime)}m`
                  : `${(stats.avgResolutionTime / 60).toFixed(1)}h`
                : '—'}
            </p>
          </CardContent>
        </Card>

        {/* SLA compliance */}
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <CheckCircle2 className="h-3.5 w-3.5" />
              SLA Compliance
            </div>
            <p className="text-2xl font-bold text-foreground">
              {stats.slaCompliance != null ? `${stats.slaCompliance}%` : '—'}
            </p>
          </CardContent>
        </Card>

        {/* Volume trend sparkline */}
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <BarChart3 className="h-3.5 w-3.5" />
              Volume Trend
            </div>
            <div className="flex items-center gap-3">
              <p className="text-2xl font-bold text-foreground">{stats.total ?? 0}</p>
              {volumeTrend.length > 1 && (
                <svg width="120" height="24" className="opacity-60">
                  <polyline
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    points={sparklinePoints}
                    className="text-primary"
                  />
                </svg>
              )}
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Bottom row */}
      <motion.div variants={itemVariants} className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* By category */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              By Category
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2.5">
              {stats.byCategory && Object.entries(stats.byCategory).length > 0 ? (
                Object.entries(stats.byCategory)
                  .sort(([, a], [, b]) => (b as number) - (a as number))
                  .map(([cat, count]) => {
                    const catObj = categories.find((c) => c.id === cat);
                    const pct = stats.total ? ((count as number) / (stats.total || 1)) * 100 : 0;
                    return (
                      <div key={cat} className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-foreground">{catObj?.name || cat}</span>
                          <span className="text-muted-foreground">{count as number}</span>
                        </div>
                        <div className="h-1.5 w-full rounded-full bg-surface-3">
                          <div
                            className="h-1.5 rounded-full bg-primary transition-all"
                            style={{ width: `${Math.min(100, pct)}%` }}
                          />
                        </div>
                      </div>
                    );
                  })
              ) : (
                <p className="text-xs text-muted-foreground">No data available</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* By priority */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              By Priority
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2.5">
              {stats.byPriority && Object.entries(stats.byPriority).length > 0 ? (
                Object.entries(stats.byPriority)
                  .sort(([, a], [, b]) => (b as number) - (a as number))
                  .map(([pri, count]) => {
                    const pct = stats.total ? ((count as number) / (stats.total || 1)) * 100 : 0;
                    const colors: Record<string, string> = {
                      critical: 'bg-red-500',
                      high: 'bg-orange-500',
                      medium: 'bg-yellow-500',
                      low: 'bg-green-500',
                    };
                    return (
                      <div key={pri} className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="capitalize text-foreground">{pri}</span>
                          <span className="text-muted-foreground">{count as number}</span>
                        </div>
                        <div className="h-1.5 w-full rounded-full bg-surface-3">
                          <div
                            className={cn('h-1.5 rounded-full transition-all', colors[pri] || 'bg-primary')}
                            style={{ width: `${Math.min(100, pct)}%` }}
                          />
                        </div>
                      </div>
                    );
                  })
              ) : (
                <p className="text-xs text-muted-foreground">No data available</p>
              )}
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Recent activity */}
      {recentActivity.length > 0 && (
        <motion.div variants={itemVariants}>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Recent Activity
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="max-h-64">
                <div className="space-y-3">
                  {recentActivity.slice(0, 10).map((activity, i) => {
                    const cfg = ACTIVITY_CONFIG[activity.type];
                    const Icon = cfg?.icon || Activity;
                    const actor = activity.actor;
                    return (
                      <div key={activity.id || i} className="flex items-start gap-3">
                        <div className={cn(
                          'flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
                          cfg?.bgColor || 'bg-muted-foreground/10'
                        )}>
                          <Icon className={cn('h-3.5 w-3.5', cfg?.color || 'text-muted-foreground')} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs text-foreground">
                            <span className="font-semibold">{getUserDisplayName(actor)}</span>{' '}
                            <span className="text-muted-foreground">{activity.description}</span>
                          </p>
                          <p className="text-[10px] text-muted-foreground">{timeAgo(activity.createdAt)}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </motion.div>
      )}
    </div>
  );
}

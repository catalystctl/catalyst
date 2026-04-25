import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Radio,
  RotateCcw,
  Home,
  Server,
  Zap,
  Trophy,
  Activity,
  Crosshair,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import {
  useResourceBalancer,
  type ResourceKey,
} from '@/hooks/useResourceBalancer';

function StatusDot({ value, gameOver }: { value: number; gameOver: boolean }) {
  const color =
    gameOver || value >= 90
      ? 'bg-danger'
      : value >= 70
        ? 'bg-warning'
        : 'bg-success';
  return (
    <span
      className={cn('inline-block h-2 w-2 rounded-full', color)}
      aria-hidden="true"
    />
  );
}

function NotFoundPage() {
  const { game, highScore, flush, reset, reducedMotion, resources } =
    useResourceBalancer();
  const [waveNotice, setWaveNotice] = useState(false);
  const lastWaveRef = useRef(1);

  useEffect(() => {
    if (game.elapsed === 0) {
      lastWaveRef.current = 1;
    }
  }, [game.elapsed]);

  useEffect(() => {
    if (game.wave > lastWaveRef.current) {
      lastWaveRef.current = game.wave;
      setWaveNotice(true);
      const timer = window.setTimeout(() => setWaveNotice(false), 2500);
      return () => window.clearTimeout(timer);
    }
  }, [game.wave]);

  const stabilityPercent = Math.round(game.stability);
  const stabilityColor =
    stabilityPercent > 60
      ? 'bg-success'
      : stabilityPercent > 30
        ? 'bg-warning'
        : 'bg-danger';

  return (
    <main className="app-shell relative flex min-h-screen items-center justify-center px-4 py-12">
      {/* Background */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,hsl(var(--primary)/0.06),transparent_60%)]" />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.03] dark:opacity-[0.05]"
        style={{
          backgroundImage:
            'radial-gradient(circle, hsl(var(--foreground)) 1px, transparent 1px)',
          backgroundSize: '24px 24px',
        }}
      />

      <Card
        className={cn(
          'relative z-10 w-full max-w-2xl overflow-hidden transition-colors duration-500',
          game.gameOver && 'border-danger/40',
          !game.gameOver && stabilityPercent <= 20 && 'border-danger/30',
        )}
      >
        {/* Wave notice */}
        {waveNotice && !game.gameOver && (
          <div className="absolute inset-x-0 top-0 z-20 flex justify-center p-4">
            <Badge
              variant="warning"
              className="animate-in fade-in slide-in-from-top-2 duration-300"
            >
              <Zap className="h-3 w-3" />
              Wave {game.wave} — Load increasing
            </Badge>
          </div>
        )}

        {/* Game over overlay */}
        {game.gameOver && (
          <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-card/70 backdrop-blur-sm">
            <h2 className="font-display text-3xl font-bold tracking-tight text-danger">
              System failure
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Infrastructure critical. Reboot required.
            </p>
            <div className="mt-3 flex items-center gap-3">
              <div className="text-lg font-bold tabular-nums text-foreground">
                Score: {game.score}
              </div>
              {game.newHighScore && (
                <Badge variant="warning" className="gap-1">
                  <Trophy className="h-3 w-3" />
                  New best
                </Badge>
              )}
            </div>
            <Button className="mt-5" size="sm" onClick={reset}>
              <RotateCcw className="h-4 w-4" />
              Reboot system
            </Button>
          </div>
        )}

        <CardContent className="flex flex-col gap-6 p-6 sm:p-8">
          {/* Header */}
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant="outline"
                className="w-fit gap-1.5 rounded-full uppercase tracking-wider"
              >
                <Radio className="h-3 w-3" />
                404 &middot; Sector offline
              </Badge>
              {game.newHighScore && (
                <Badge variant="warning" className="gap-1.5">
                  <Trophy className="h-3 w-3" />
                  New high score
                </Badge>
              )}
            </div>
            <h1 className="font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              {game.gameOver ? 'Connection lost' : 'Resource overload'}
            </h1>
            <p className="max-w-md text-base text-muted-foreground">
              {game.gameOver
                ? 'The page you are looking for does not exist.'
                : 'Keep resources below capacity. Click a metric card to flush it before overflow.'}
            </p>
          </div>

          {/* Resource widgets */}
          <div
            className="grid grid-cols-1 gap-3 sm:grid-cols-3"
            role="region"
            aria-label="Resource balancer game"
          >
            {resources.map((res) => {
              const value = game[res.key] as number;
              const isCritical = value > 80;
              const isWarning = value > 60;
              const Icon = res.icon;

              return (
                <button
                  key={res.key}
                  type="button"
                  disabled={game.gameOver}
                  onClick={() => flush(res.key as ResourceKey)}
                  className={cn(
                    'group relative flex flex-col gap-3 rounded-xl border border-border bg-card p-4 text-left',
                    'transition-all hover:border-primary/30 hover:shadow-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                    'disabled:cursor-not-allowed disabled:opacity-50',
                    isCritical &&
                      !game.gameOver &&
                      !reducedMotion &&
                      'animate-pulse',
                  )}
                  aria-label={`Flush ${res.label} at ${Math.round(value)} percent`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div
                        className={cn(
                          'flex h-8 w-8 items-center justify-center rounded-lg bg-surface-2',
                          res.color,
                        )}
                      >
                        <Icon className="h-4 w-4" />
                      </div>
                      <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        {res.label}
                      </span>
                    </div>
                    <StatusDot value={value} gameOver={game.gameOver} />
                  </div>

                  <div
                    className={cn(
                      'font-display text-3xl font-bold tabular-nums transition-colors',
                      isCritical ? 'text-danger' : 'text-foreground',
                    )}
                  >
                    {Math.round(value)}%
                  </div>

                  <div className="h-2.5 overflow-hidden rounded-full bg-surface-2">
                    <div
                      className={cn(
                        'h-full rounded-full transition-all duration-100',
                        res.bg,
                        isWarning && 'opacity-90',
                        isCritical && 'opacity-100',
                      )}
                      style={{ width: `${value}%` }}
                    />
                  </div>
                </button>
              );
            })}
          </div>

          {/* Stability */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <Activity className="h-3.5 w-3.5" />
                System stability
              </div>
              <span
                className={cn(
                  'font-semibold tabular-nums',
                  stabilityPercent <= 20 && 'text-danger',
                )}
              >
                {stabilityPercent}%
              </span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-surface-2">
              <div
                className={cn(
                  'h-full rounded-full transition-all duration-300',
                  stabilityColor,
                )}
                style={{ width: `${game.stability}%` }}
              />
            </div>
          </div>

          {/* Event log */}
          {game.events.length > 0 && (
            <div className="rounded-lg border border-border bg-surface-0/60 p-3">
              <div className="space-y-1 font-mono text-[11px]">
                {game.events.map((event) => (
                  <div
                    key={event.id}
                    className={cn(
                      'flex items-start gap-2',
                      event.type === 'danger' && 'text-danger',
                      event.type === 'success' && 'text-success',
                      event.type === 'warning' && 'text-warning',
                      event.type === 'info' && 'text-primary',
                    )}
                  >
                    <span className="mt-0.5 text-muted-foreground">{'>'}</span>
                    <span>{event.message}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Stats */}
          <div
            className="flex flex-wrap items-center gap-3"
            aria-live="polite"
            aria-atomic="false"
          >
            <div className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface-0 px-3 py-2 text-xs text-muted-foreground">
              <Crosshair className="h-3.5 w-3.5 text-primary" />
              Score
              <span className="font-semibold tabular-nums text-foreground">
                {game.score}
              </span>
            </div>
            <div className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface-0 px-3 py-2 text-xs text-muted-foreground">
              <Zap className="h-3.5 w-3.5 text-primary" />
              Wave
              <span className="font-semibold tabular-nums text-foreground">
                {game.wave}
              </span>
            </div>
            {game.combo > 1 && (
              <Badge variant="default" className="gap-1.5">
                <Zap className="h-3 w-3" />
                {game.combo}x combo
              </Badge>
            )}
            <div className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface-0 px-3 py-2 text-xs text-muted-foreground">
              <Trophy className="h-3.5 w-3.5 text-warning" />
              Best
              <span className="font-semibold tabular-nums text-foreground">
                {Math.max(highScore, game.score)}
              </span>
            </div>
          </div>

          <Separator />

          {/* Actions */}
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={reset}
              className={cn(
                game.gameOver &&
                  'border-danger/50 text-danger hover:bg-danger/10',
              )}
            >
              <RotateCcw className="h-4 w-4" />
              {game.gameOver ? 'Reboot' : 'Restart'}
            </Button>
            <Button size="sm" asChild>
              <Link to="/dashboard">
                <Home className="h-4 w-4" />
                Dashboard
              </Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link to="/servers">
                <Server className="h-4 w-4" />
                Servers
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}

export default NotFoundPage;

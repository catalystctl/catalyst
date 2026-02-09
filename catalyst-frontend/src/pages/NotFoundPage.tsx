import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

const GRID_ROWS = 8;
const GRID_COLS = 8;
const INITIAL_POWER = 12;
const randomGridIndex = () => Math.floor(Math.random() * GRID_ROWS * GRID_COLS);

function NotFoundPage() {
  const [targetIndex, setTargetIndex] = useState(12);
  const [score, setScore] = useState(0);
  const [power, setPower] = useState(INITIAL_POWER);
  const [message, setMessage] = useState<'idle' | 'hit' | 'miss' | 'timeout'>('idle');

  const cells = useMemo(
    () => Array.from({ length: GRID_ROWS * GRID_COLS }, (_, index) => index),
    [],
  );

  useEffect(() => {
    if (power <= 0) return;
    const interval = window.setInterval(() => {
      setTargetIndex(randomGridIndex());
      setPower((current) => Math.max(0, current - 1));
    }, 1200);
    return () => window.clearInterval(interval);
  }, [power]);

  const handleCellClick = (index: number) => {
    if (power <= 0) return;
    if (index === targetIndex) {
      setScore((current) => current + 1);
      setMessage('hit');
      setTargetIndex(randomGridIndex());
      setPower((current) => current + 2);
      window.setTimeout(() => setMessage('idle'), 350);
    } else {
      setMessage('miss');
      setPower((current) => Math.max(0, current - 2));
      window.setTimeout(() => setMessage('idle'), 350);
    }
  };
  const displayedMessage = power <= 0 ? 'timeout' : message;

  return (
    <div className="app-shell relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-4 text-center text-slate-900 dark:text-slate-100">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.12),_transparent_55%)]" />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-slate-50 via-white to-slate-100 dark:from-slate-950 dark:via-slate-950 dark:to-slate-900" />
      <div className="relative z-10 grid w-full max-w-5xl gap-8 md:grid-cols-[1.1fr_1fr]">
        <div className="flex flex-col items-center gap-4 text-center md:items-start md:text-left">
          <p className="text-sm uppercase tracking-widest text-slate-500 dark:text-slate-400 dark:text-slate-500">
            404 • Sector offline
          </p>
          <h1 className="text-3xl font-semibold">Signal lost in the void</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Fire the recon grid to lock onto a stable route. Hit the pulsing core before the power
            cell drains.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3 text-xs">
            <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
              Score: <span className="font-semibold text-slate-900 dark:text-slate-100">{score}</span>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
              Power: <span className="font-semibold text-slate-900 dark:text-slate-100">{power}</span>
            </div>
            <div
              className={`rounded-lg border px-3 py-2 text-xs font-semibold ${
                displayedMessage === 'hit'
                  ? 'border-emerald-200 bg-emerald-100 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300'
                  : displayedMessage === 'miss'
                    ? 'border-rose-200 bg-rose-100 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300'
                    : displayedMessage === 'timeout'
                      ? 'border-amber-200 bg-amber-100 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300'
                      : 'border-slate-200 bg-white text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300'
              }`}
            >
              {displayedMessage === 'hit'
                ? 'Direct hit!'
                : displayedMessage === 'miss'
                  ? 'Missed signal'
                  : displayedMessage === 'timeout'
                    ? 'Power depleted'
                    : 'Scanning'}
            </div>
          </div>
          <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            {power <= 0 ? 'Recharge to keep scanning.' : 'Click the glowing node to score.'}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3 text-xs">
            <button
              type="button"
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 transition-all duration-300 hover:border-primary-500 hover:text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-primary-500/30"
              onClick={() => {
                setScore(0);
                setPower(INITIAL_POWER);
                setTargetIndex(randomGridIndex());
                setMessage('idle');
              }}
            >
              Restart scan
            </button>
            <Link
              to="/dashboard"
              className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-primary-500/20 transition-all duration-300 hover:bg-primary-500"
            >
              Go to dashboard
            </Link>
            <Link
              to="/servers"
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 transition-all duration-300 hover:border-primary-500 hover:text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-primary-500/30"
            >
              View servers
            </Link>
          </div>
        </div>

        <div className="flex items-center justify-center">
          <div className="grid grid-cols-8 gap-2 rounded-2xl border border-slate-200 bg-white/70 p-5 shadow-surface-light backdrop-blur dark:border-slate-800 dark:bg-slate-950/70 dark:shadow-surface-dark">
            {cells.map((index) => {
              const isTarget = index === targetIndex;
              return (
                <button
                  key={index}
                  type="button"
                  disabled={power <= 0}
                  onClick={() => handleCellClick(index)}
                  className={`h-6 w-6 rounded-md border transition-all duration-300 ${
                    isTarget
                      ? 'border-primary-400 bg-primary-500 shadow-[0_0_16px_rgba(59,130,246,0.9)] animate-pulse'
                      : 'border-slate-200 bg-white hover:border-primary-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-primary-500/40'
                  }`}
                  aria-label={isTarget ? 'Target node' : 'Empty node'}
                />
              );
            })}
          </div>
        </div>

      </div>
    </div>
  );
}

export default NotFoundPage;

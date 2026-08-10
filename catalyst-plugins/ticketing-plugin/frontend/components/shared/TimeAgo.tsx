import { useEffect, useState } from 'react';

function format(date: string | null | undefined): string {
  if (!date) return '—';
  const ts = new Date(date).getTime();
  if (Number.isNaN(ts)) return '—';
  const diff = Date.now() - ts;
  const sec = Math.round(diff / 1000);
  if (sec < 60) return 'just now';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day}d ago`;
  return new Date(date).toLocaleDateString();
}

export function TimeAgo({ date, className }: { date: string | null | undefined; className?: string }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);
  return (
    <time className={className} dateTime={date ?? undefined} title={date ?? undefined}>
      {format(date)}
    </time>
  );
}

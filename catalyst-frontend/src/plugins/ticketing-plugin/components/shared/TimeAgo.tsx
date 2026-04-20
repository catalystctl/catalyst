import { useState, useEffect } from 'react';
import { cn, TEXT_MUTED } from '../../../plugin-ui';

interface TimeAgoProps {
  date: string;
  className?: string;
}

function computeLabel(isoDate: string): string {
  const then = new Date(isoDate).getTime();
  const now = Date.now();
  const diffMs = now - then;

  if (diffMs < 0) return 'just now';

  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;

  // For older dates, show month + day
  const d = new Date(isoDate);
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${monthNames[d.getMonth()]} ${d.getDate()}`;
}

export function TimeAgo({ date, className }: TimeAgoProps) {
  const [label, setLabel] = useState(() => computeLabel(date));

  useEffect(() => {
    // Auto-update every 60s for recent times (< 1 hour old)
    const then = new Date(date).getTime();
    const diffMs = Date.now() - then;
    const isRecent = diffMs < 3600000;

    if (!isRecent) return;

    const interval = setInterval(() => {
      setLabel(computeLabel(date));
    }, 60000);

    return () => clearInterval(interval);
  }, [date]);

  return (
    <time dateTime={date} className={cn(TEXT_MUTED, className)} title={new Date(date).toLocaleString()}>
      {label}
    </time>
  );
}

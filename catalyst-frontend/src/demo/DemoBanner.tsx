import { useTranslation } from 'react-i18next';
import { isDemoMode } from './isDemo';

// Fixed-height banner shown only in the static demo so visitors know the
// data is fictional and mutations are not persisted. Fixed h-8 (never wraps)
// so AppLayout can offset the shell and mobile header by exactly 2rem.
export default function DemoBanner() {
  const { t } = useTranslation('common');
  if (!isDemoMode) return null;
  return (
    <div
      role="status"
      title={t('demo.banner')}
      className="fixed inset-x-0 top-0 z-40 flex h-8 items-center justify-center gap-2 border-b border-primary/30 bg-card px-3 font-mono text-[11px] text-foreground/80"
    >
      {/* Pulsing lab marker instead of a bright full-width accent bar */}
      <span aria-hidden="true" className="relative flex h-1.5 w-1.5 shrink-0">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-50" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
      </span>
      <span className="truncate">{t('demo.banner')}</span>
    </div>
  );
}

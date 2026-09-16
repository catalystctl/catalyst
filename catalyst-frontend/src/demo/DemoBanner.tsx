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
      className="fixed inset-x-0 top-0 z-40 flex h-8 items-center justify-center gap-1.5 bg-primary px-3 text-[11px] font-medium text-primary-foreground"
    >
      <span aria-hidden="true" className="shrink-0">◆</span>
      <span className="truncate">{t('demo.banner')}</span>
    </div>
  );
}

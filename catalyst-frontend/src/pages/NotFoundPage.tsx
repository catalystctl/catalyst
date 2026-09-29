import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LayoutDashboard, Server } from 'lucide-react';
import { BracketLabel, StatusLed } from '@/components/deck/primitives';

/**
 * Rendered by the catch-all routes: inside AppLayout for signed-in users, and
 * inside a centred shell by the anonymous catch-all in App.tsx. It carries no
 * page frame of its own so the deck's panel is the only surface.
 */
function NotFoundPage() {
  const { t } = useTranslation('auth');
  return (
    <div className="mx-auto w-full max-w-xl">
      <div className="deck-panel px-3 py-6 text-center">
        <div className="flex items-center justify-center gap-1.5">
          <StatusLed tone="alarm" />
          <BracketLabel>{t('status.error', { ns: 'common' })}</BracketLabel>
        </div>
        <p aria-hidden="true" className="mt-3 font-display text-5xl font-semibold tracking-tight text-foreground">
          404
        </p>
        <h1 className="mt-2 font-display text-lg font-semibold leading-none tracking-tight text-foreground">
          {t('notFound.title')}
        </h1>
        <p className="type-meta mt-1">{t('notFound.description')}</p>
        <div className="mt-4 flex flex-col justify-center gap-2 sm:flex-row">
          <Link
            to="/dashboard"
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-sm bg-primary px-3 text-mini font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <LayoutDashboard className="h-4 w-4" />
            {t('notFound.dashboard')}
          </Link>
          <Link
            to="/servers"
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-sm border border-border/60 px-3 text-mini font-medium text-muted-foreground transition-colors hover:border-border hover:text-foreground"
          >
            <Server className="h-4 w-4" />
            {t('notFound.servers')}
          </Link>
        </div>
      </div>
    </div>
  );
}

export default NotFoundPage;

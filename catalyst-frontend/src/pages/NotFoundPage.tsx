import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LayoutDashboard, Server } from 'lucide-react';
import { BracketLabel } from '@/components/deck/primitives';

/**
 * Rendered by the catch-all routes: inside AppLayout for signed-in users, and
 * inside a centred shell by the anonymous catch-all in App.tsx. It carries no
 * page frame of its own so the deck's panel is the only surface.
 */
function NotFoundPage() {
  const { t } = useTranslation('auth');
  return (
    <div className="mx-auto w-full max-w-xl">
      <header className="flex min-w-0 flex-col gap-1">
        <BracketLabel>{t('status.error', { ns: 'common' })}</BracketLabel>
        <h1 className="font-display text-lg font-semibold leading-none tracking-tight text-foreground">
          {t('notFound.title')}
        </h1>
        <p className="type-meta">{t('notFound.description')}</p>
      </header>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
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
  );
}

export default NotFoundPage;

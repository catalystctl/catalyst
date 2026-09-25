import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FileQuestion, LayoutDashboard, Server } from 'lucide-react';
import { Button } from '@/components/ui/button';

function NotFoundPage() {
  const { t } = useTranslation('auth');
  return (
    <main className="app-shell flex min-h-screen items-center justify-center px-4 py-12">
      <div className="deck-panel w-full max-w-xl overflow-hidden">
        <div className="flex items-start gap-2.5 border-b border-border/50 bg-surface-1/40 px-4 py-3">
          <FileQuestion className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <h1 className="font-display text-lg font-semibold tracking-tight text-foreground">
              {t('notFound.title')}
            </h1>
            <p className="type-meta mt-1">{t('notFound.description')}</p>
          </div>
        </div>
        <div className="flex flex-col gap-2 px-4 py-3 sm:flex-row">
          <Button asChild size="sm" className="h-8 px-3 text-mini">
            <Link to="/dashboard">
              <LayoutDashboard className="h-4 w-4" />
              {t('notFound.dashboard')}
            </Link>
          </Button>
          <Button variant="outline" asChild size="sm" className="h-8 px-3 text-mini">
            <Link to="/servers">
              <Server className="h-4 w-4" />
              {t('notFound.servers')}
            </Link>
          </Button>
        </div>
      </div>
    </main>
  );
}

export default NotFoundPage;

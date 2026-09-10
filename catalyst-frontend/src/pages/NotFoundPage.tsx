import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FileQuestion, LayoutDashboard, Server } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import TabHeader from '@/components/servers/tabs/TabHeader';

function NotFoundPage() {
  const { t } = useTranslation('auth');
  return (
    <main className="app-shell flex min-h-screen items-center justify-center px-4 py-12">
      <Card className="w-full max-w-xl rounded-xl border-border/50 bg-card">
        <CardContent className="space-y-6 p-6 sm:p-8">
          <TabHeader
            icon={FileQuestion}
            title={t('notFound.title')}
            description={t('notFound.description')}
          />
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button asChild>
              <Link to="/dashboard">
                <LayoutDashboard className="h-4 w-4" />
                {t('notFound.dashboard')}
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/servers">
                <Server className="h-4 w-4" />
                {t('notFound.servers')}
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}

export default NotFoundPage;

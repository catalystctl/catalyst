import { useMemo, useState } from 'react';
import { useTemplates } from '../../hooks/useTemplates';
import TemplateCreateModal from '../../components/templates/TemplateCreateModal';
import TemplateList from '../../components/templates/TemplateList';
import EmptyState from '../../components/shared/EmptyState';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { useAuthStore } from '../../stores/authStore';

type Props = {
  hideHeader?: boolean;
};

function TemplatesPage({ hideHeader }: Props) {
  const { data: templates = [], isLoading } = useTemplates();
  const [search, setSearch] = useState('');
  const { user } = useAuthStore();
  const canWrite = useMemo(
    () => user?.permissions?.includes('admin.write') || user?.permissions?.includes('*'),
    [user?.permissions],
  );
  const filteredTemplates = useMemo(() => {
    if (!search.trim()) return templates;
    const query = search.trim().toLowerCase();
    return templates.filter(
      (template) =>
        template.name.toLowerCase().includes(query) ||
        template.author.toLowerCase().includes(query),
    );
  }, [templates, search]);

  return (
    <div className={hideHeader ? '' : 'space-y-6'}>
      {!hideHeader && (
        <>
          <Card className="rounded-2xl">
            <CardContent className="p-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Templates</h1>
                  <p className="text-sm text-slate-600 dark:text-slate-400">
                    Define server templates with images and start commands.
                  </p>
                </div>
                {canWrite ? (
                  <TemplateCreateModal />
                ) : (
                  <span className="text-xs text-slate-500 dark:text-slate-400">Admin access required</span>
                )}
              </div>
              <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-600 dark:text-slate-400">
                <Badge variant="outline">{templates.length} templates available</Badge>
                <Badge variant="outline">{filteredTemplates.length} shown</Badge>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Search</Label>
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search templates"
                    className="w-56"
                  />
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  Showing {filteredTemplates.length} template{filteredTemplates.length === 1 ? '' : 's'}
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      )}
      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 2 }).map((_, i) => (
            <div
              key={i}
              className="animate-pulse rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div className="h-12 w-12 rounded-xl bg-slate-200 dark:bg-slate-800" />
                  <div>
                    <div className="h-6 w-32 rounded bg-slate-200 dark:bg-slate-800" />
                    <div className="mt-2 flex gap-2">
                      <div className="h-5 w-16 rounded-full bg-slate-200 dark:bg-slate-800" />
                      <div className="h-5 w-12 rounded-full bg-slate-200 dark:bg-slate-800" />
                    </div>
                  </div>
                </div>
                <div className="flex gap-2">
                  <div className="h-7 w-14 rounded-full bg-slate-200 dark:bg-slate-800" />
                  <div className="h-7 w-14 rounded-full bg-slate-200 dark:bg-slate-800" />
                </div>
              </div>
              <div className="mt-3 space-y-1">
                <div className="h-3 w-full rounded bg-slate-200 dark:bg-slate-800" />
                <div className="h-3 w-3/4 rounded bg-slate-200 dark:bg-slate-800" />
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-900">
                  <div className="h-2.5 w-10 rounded bg-slate-200 dark:bg-slate-800" />
                  <div className="mt-1 h-4 w-24 rounded bg-slate-200 dark:bg-slate-800" />
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-900">
                  <div className="h-2.5 w-16 rounded bg-slate-200 dark:bg-slate-800" />
                  <div className="mt-1 h-4 w-20 rounded bg-slate-200 dark:bg-slate-800" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : filteredTemplates.length ? (
        <TemplateList templates={filteredTemplates} />
      ) : (
        <EmptyState
          title={search.trim() ? 'No templates found' : 'No templates'}
          description={
            search.trim()
              ? 'Try a different template name or author.'
              : 'Create a template to bootstrap new game servers quickly.'
          }
          action={canWrite ? <TemplateCreateModal /> : null}
        />
      )}
    </div>
  );
}

export default TemplatesPage;

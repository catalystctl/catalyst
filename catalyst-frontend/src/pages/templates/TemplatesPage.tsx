import { useMemo, useState } from 'react';
import { motion, type Variants } from 'framer-motion';
import { FileCode, Search } from 'lucide-react';
import { useTemplates } from '../../hooks/useTemplates';
import TemplateCreateModal from '../../components/templates/TemplateCreateModal';
import TemplateList from '../../components/templates/TemplateList';
import EmptyState from '../../components/shared/EmptyState';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useAuthStore } from '../../stores/authStore';

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.05, delayChildren: 0.05 },
  },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { type: 'spring', stiffness: 300, damping: 24 },
  },
};

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
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="relative min-h-screen overflow-hidden"
    >
      {/* Ambient background */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-32 -right-32 h-80 w-80 rounded-full bg-gradient-to-br from-amber-500/8 to-rose-500/8 blur-3xl dark:from-amber-500/15 dark:to-rose-500/15" />
        <div className="absolute bottom-0 -left-32 h-80 w-80 rounded-full bg-gradient-to-tr from-violet-500/8 to-cyan-500/8 blur-3xl dark:from-violet-500/15 dark:to-cyan-500/15" />
      </div>

      <div className="relative z-10 space-y-5">
        {!hideHeader && (
          <>
            {/* ── Header ── */}
            <motion.div variants={itemVariants} className="flex flex-wrap items-end justify-between gap-4">
              <div className="space-y-1.5">
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <div className="absolute -inset-1 rounded-lg bg-gradient-to-r from-amber-500 to-rose-500 opacity-20 blur-sm" />
                    <FileCode className="relative h-7 w-7 text-amber-600 dark:text-amber-400" />
                  </div>
                  <h1 className="font-display text-3xl font-bold tracking-tight text-foreground dark:text-white">
                    Templates
                  </h1>
                </div>
                <p className="ml-10 text-sm text-muted-foreground">
                  Define server templates with images and start commands.
                </p>
              </div>

              {canWrite ? (
                <TemplateCreateModal />
              ) : (
                <span className="text-xs text-muted-foreground">Admin access required</span>
              )}
            </motion.div>

            {/* ── Search Bar ── */}
            <motion.div
              variants={itemVariants}
              className="flex flex-wrap items-center gap-3"
            >
              <div className="relative min-w-[200px] flex-1 max-w-sm">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search templates…"
                  className="pl-9"
                />
              </div>

              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-xs">
                  {filteredTemplates.length} template{filteredTemplates.length !== 1 ? 's' : ''}
                </Badge>
              </div>
            </motion.div>
          </>
        )}

        {/* ── Template Grid ── */}
        {isLoading ? (
          <motion.div variants={itemVariants} className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="relative overflow-hidden rounded-xl border border-border bg-card/80"
              >
                <div className="p-5">
                  <div className="flex items-start gap-3">
                    <div className="h-12 w-12 animate-pulse rounded-xl bg-surface-3" />
                    <div className="flex-1 space-y-2">
                      <div className="h-5 w-32 animate-pulse rounded bg-surface-3" />
                      <div className="flex gap-2">
                        <div className="h-4 w-16 animate-pulse rounded-full bg-surface-2" />
                        <div className="h-4 w-12 animate-pulse rounded-full bg-surface-2" />
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 space-y-1">
                    <div className="h-3 w-full animate-pulse rounded bg-surface-2" />
                    <div className="h-3 w-3/4 animate-pulse rounded bg-surface-2" />
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-2.5">
                    {[1, 2].map((j) => (
                      <div key={j} className="h-16 animate-pulse rounded-lg bg-surface-2/50" />
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </motion.div>
        ) : filteredTemplates.length > 0 ? (
          <TemplateList templates={filteredTemplates} />
        ) : (
          <motion.div variants={itemVariants}>
            <EmptyState
              title={search.trim() ? 'No templates found' : 'No templates'}
              description={
                search.trim()
                  ? 'Try a different template name or author.'
                  : 'Create a template to bootstrap new game servers quickly.'
              }
              action={
                canWrite && !search.trim() ? <TemplateCreateModal /> : undefined
              }
            />
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}

export default TemplatesPage;

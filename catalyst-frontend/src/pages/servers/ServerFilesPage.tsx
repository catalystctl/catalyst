import { useParams } from 'react-router-dom';
import { motion, type Variants } from 'framer-motion';
import { FolderOpen, Loader2 } from 'lucide-react';
import FileManager from '../../components/files/FileManager';
import EmptyState from '../../components/shared/EmptyState';
import { useServer } from '../../hooks/useServer';

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.06, delayChildren: 0.05 } },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 300, damping: 24 } },
};

function ServerFilesPage() {
  const { serverId } = useParams();
  const { data: server, isLoading, isError } = useServer(serverId);
  const title = server?.name ?? serverId ?? 'Unknown server';

  if (!serverId) {
    return (
      <EmptyState
        title="No server selected"
        description="Select a server to manage its files."
      />
    );
  }

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="relative min-h-screen overflow-hidden"
    >
      {/* Ambient background */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-32 -right-32 h-80 w-80 rounded-full bg-gradient-to-br from-primary-500/8 to-primary-300/8 blur-3xl dark:from-primary-500/15 dark:to-primary-300/15" />
        <div className="absolute bottom-0 -left-32 h-80 w-80 rounded-full bg-gradient-to-tr from-primary-400/8 to-primary-200/8 blur-3xl dark:from-primary-400/15 dark:to-primary-200/15" />
      </div>

      <div className="relative z-10 space-y-5">
        {/* ── Header ── */}
        <motion.div variants={itemVariants} className="flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-3">
              <div className="relative">
                <div className="absolute -inset-1 rounded-lg bg-gradient-to-r from-primary-500 to-primary-400 opacity-20 blur-sm" />
                <FolderOpen className="relative h-7 w-7 text-primary" />
              </div>
              <h1 className="font-display text-3xl font-bold tracking-tight text-foreground">Files</h1>
              <span className="text-lg text-foreground">—</span>
              <span className="text-lg font-medium text-muted-foreground">{title}</span>
            </div>
            <p className="ml-10 text-sm text-muted-foreground">
              Upload, edit, and manage server files.
            </p>
          </div>
        </motion.div>

        {/* ── Content ── */}
        <motion.div variants={itemVariants}>
          {isLoading ? (
            <div className="flex items-center justify-center rounded-xl border border-border/50 bg-card/80 p-12 backdrop-blur-sm">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : isError ? (
            <div className="rounded-xl border border-danger/30 bg-danger-muted px-6 py-4 text-sm text-danger">
              Unable to load server details.
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-border/50 bg-card/80 backdrop-blur-sm transition-all duration-300 hover:shadow-md">
              <FileManager serverId={serverId} isSuspended={server?.status === 'suspended'} />
            </div>
          )}
        </motion.div>
      </div>
    </motion.div>
  );
}

export default ServerFilesPage;

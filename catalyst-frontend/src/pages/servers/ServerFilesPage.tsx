import { useParams } from 'react-router-dom';
import FileManager from '../../components/files/FileManager';
import EmptyState from '../../components/shared/EmptyState';
import { useServer } from '../../hooks/useServer';

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
    <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
          <h1 className="text-2xl font-semibold text-foreground dark:text-white">Files - {title}</h1>
          <p className="text-sm text-muted-foreground dark:text-muted-foreground">
            Upload, edit, and manage server files.
          </p>
          </div>
        </div>
      {isLoading ? (
        <div className="rounded-xl border border-border bg-white px-4 py-6 text-muted-foreground shadow-surface-light dark:shadow-surface-dark transition-all duration-300 hover:border-primary-500 dark:border-border dark:bg-surface-1 dark:text-zinc-300 dark:hover:border-primary/30">
          Loading file manager...
        </div>
      ) : isError ? (
        <div className="rounded-xl border border-rose-200 bg-rose-100/60 px-4 py-6 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
          Unable to load server details.
        </div>
      ) : (
        <FileManager serverId={serverId} isSuspended={server?.status === 'suspended'} />
      )}
    </div>
  );
}

export default ServerFilesPage;

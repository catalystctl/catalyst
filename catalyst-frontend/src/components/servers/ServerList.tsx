import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import type { Server } from '../../types/server';
import ServerCard from './ServerCard';
import ServerListItem from './ServerListItem';
import TabEmptyState from './tabs/TabEmptyState';
import { DeckRows } from '../deck/primitives';

type ViewMode = 'card' | 'list';

function ServerListBase({ servers, viewMode = 'card' }: { servers: Server[]; viewMode?: ViewMode }) {
  const { t } = useTranslation('servers');

  if (!servers.length) {
    return (
      <div className="deck-panel">
        <TabEmptyState
          title={t('list.emptyTitle')}
          description={t('list.emptyDescription')}
        />
      </div>
    );
  }

  if (viewMode === 'list') {
    return (
      <DeckRows>
        {servers.map((server) => (
          <ServerListItem key={server.id} server={server} />
        ))}
      </DeckRows>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
      {servers.map((server) => (
        <ServerCard key={server.id} server={server} />
      ))}
    </div>
  );
}

const ServerList = memo(ServerListBase);
export default ServerList;

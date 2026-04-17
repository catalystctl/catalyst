import type { Server } from '../../types/server';
import ServerCard from './ServerCard';
import ServerListItem from './ServerListItem';
import EmptyState from '../shared/EmptyState';
import { motion, type Variants } from 'framer-motion';

type ViewMode = 'card' | 'list';

const cardVariants: Variants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 300, damping: 24 } },
};

const listVariants: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 400, damping: 30, staggerChildren: 0.03 } },
};

function ServerList({ servers, viewMode = 'card' }: { servers: Server[]; viewMode?: ViewMode }) {
  if (!servers.length) {
    return <EmptyState title="No servers" description="Create a server to get started." />;
  }

  if (viewMode === 'list') {
    return (
      <motion.div
        variants={listVariants}
        initial={false}
        animate="visible"
        className="space-y-2"
      >
        {servers.map((server) => (
          <ServerListItem key={server.id} server={server} />
        ))}
      </motion.div>
    );
  }

  return (
    <motion.div
      variants={cardVariants}
      initial={false}
      animate="visible"
      className="grid grid-cols-1 gap-4 xl:grid-cols-2"
    >
      {servers.map((server) => (
        <ServerCard key={server.id} server={server} />
      ))}
    </motion.div>
  );
}

export default ServerList;

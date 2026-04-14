import type { Server } from '../../types/server';
import ServerCard from './ServerCard';
import EmptyState from '../shared/EmptyState';
import { motion, type Variants } from 'framer-motion';

const containerVariants: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.04 } },
};

function ServerList({ servers }: { servers: Server[] }) {
  if (!servers.length) {
    return <EmptyState title="No servers" description="Create a server to get started." />;
  }

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
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

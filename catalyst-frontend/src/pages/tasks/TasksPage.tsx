import { Clock } from 'lucide-react';
import TabHeader from '../../components/servers/tabs/TabHeader';
import ServerTabCard from '../../components/servers/tabs/ServerTabCard';
import TabEmptyState from '../../components/servers/tabs/TabEmptyState';

function TasksPage() {
 return (
 <div className="space-y-4">
 <TabHeader
 icon={Clock}
 title="Scheduled Tasks"
 description="Automate backups, restarts, and commands."
 actions={
 <button className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-all duration-300 hover:bg-primary/90">
 Create Task
 </button>
 }
 />
 <ServerTabCard>
 <TabEmptyState
 title="No tasks yet"
 description="Create cron-like schedules to automate server operations."
 />
 </ServerTabCard>
 </div>
 );
}

export default TasksPage;

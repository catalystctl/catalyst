import { TicketBoard } from './components/TicketBoard';

/** Admin sidebar tab — full ticket console. */
export function AdminDashboard() {
  return (
    <TicketBoard
      title="Ticketing"
      description="Track support requests, SLA, and assignments across the platform."
    />
  );
}

/** Server detail tab — tickets linked to this server. */
export function ServerTab({ serverId }: { serverId: string }) {
  return (
    <TicketBoard
      title="Server tickets"
      description="Tickets linked to this server."
      lockedServerId={serverId}
      compact
    />
  );
}

/** Standalone user page at /ticketing-plugin — my tickets. */
export function UserPage() {
  return (
    <TicketBoard
      title="My tickets"
      description="Tickets you reported or are assigned to."
      myTicketsOnly
      compact
    />
  );
}

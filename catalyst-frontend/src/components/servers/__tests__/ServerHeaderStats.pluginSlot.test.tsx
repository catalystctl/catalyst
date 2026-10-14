import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { usePluginStore } from '../../../plugins/store';
import { useAuthStore } from '../../../stores/authStore';
import type { User } from '../../../types/user';
import type { LoadedPlugin } from '../../../plugins/types';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

import ServerHeaderStats from '../ServerHeaderStats';
import type { ServerMetrics } from '../../../types/server';

const metrics = {
  cpuPercent: 10,
  memoryPercent: 20,
  memoryUsageMb: 1024,
  diskUsageMb: 1024,
  diskTotalMb: 10240,
  networkRxBytes: 0,
  networkTxBytes: 0,
} as unknown as ServerMetrics;

/** Register one component into a slot the way a plugin frontend does. */
function registerSlot(slot: string, label: string, requiredPermissions?: string[]) {
  const plugin = {
    manifest: { name: 'backup-gauge', version: '1.0.0', enabled: true },
    routes: [],
    tabs: [],
    components: [
      { slot, component: () => <span>{label}</span>, order: 50, requiredPermissions },
    ],
  } as unknown as LoadedPlugin;
  usePluginStore.setState({ plugins: [plugin] });
}

/** Set the viewer's global (panel-wide) permissions. */
function signInWith(permissions: string[]) {
  useAuthStore.setState({ user: { permissions } as unknown as User });
}

describe('ServerHeaderStats plugin slot', () => {
  afterEach(() => {
    cleanup();
    usePluginStore.setState({ plugins: [] });
    useAuthStore.setState({ user: null });
  });

  it('renders a server-header-stats component beside the built-in readings', () => {
    registerSlot('server-header-stats', 'BACKUP 52 GB / 128 GB');
    render(<ServerHeaderStats metrics={metrics} serverId="server-1" serverStatus="running" />);
    expect(screen.getByText('BACKUP 52 GB / 128 GB')).toBeInTheDocument();
  });

  it('ignores components registered for another slot', () => {
    registerSlot('dashboard-widgets', 'BACKUP 52 GB / 128 GB');
    render(<ServerHeaderStats metrics={metrics} serverId="server-1" serverStatus="running" />);
    expect(screen.queryByText('BACKUP 52 GB / 128 GB')).not.toBeInTheDocument();
  });

  it('does not render the slot without a server id', () => {
    registerSlot('server-header-stats', 'BACKUP 52 GB / 128 GB');
    render(<ServerHeaderStats metrics={metrics} />);
    expect(screen.queryByText('BACKUP 52 GB / 128 GB')).not.toBeInTheDocument();
  });

  it('still renders the slot while metrics are unavailable', () => {
    registerSlot('server-header-stats', 'BACKUP 52 GB / 128 GB');
    render(<ServerHeaderStats metrics={null} serverId="server-1" />);
    expect(screen.getByText('BACKUP 52 GB / 128 GB')).toBeInTheDocument();
  });

  it('shows a component only to viewers holding its requiredPermissions', () => {
    registerSlot('server-header-stats', 'BACKUP 52 GB / 128 GB', ['backup.read']);

    signInWith(['server.view']);
    const { unmount } = render(
      <ServerHeaderStats metrics={metrics} serverId="server-1" serverStatus="running" />,
    );
    expect(screen.queryByText('BACKUP 52 GB / 128 GB')).not.toBeInTheDocument();
    unmount();

    signInWith(['backup.read']);
    render(<ServerHeaderStats metrics={metrics} serverId="server-1" serverStatus="running" />);
    expect(screen.getByText('BACKUP 52 GB / 128 GB')).toBeInTheDocument();
  });

  it('accepts a surface check so server-scoped grants count', () => {
    registerSlot('server-header-stats', 'BACKUP 52 GB / 128 GB', ['backup.read']);

    // No panel-wide grant: only the server page's scoped check admits it.
    signInWith(['server.view']);
    render(
      <ServerHeaderStats
        metrics={metrics}
        serverId="server-1"
        serverStatus="running"
        hasPermission={(required) => required.includes('backup.read')}
      />,
    );
    expect(screen.getByText('BACKUP 52 GB / 128 GB')).toBeInTheDocument();
  });

  it('renders an ungated component for everyone', () => {
    registerSlot('server-header-stats', 'BACKUP 52 GB / 128 GB');
    signInWith([]);
    render(<ServerHeaderStats metrics={metrics} serverId="server-1" serverStatus="running" />);
    expect(screen.getByText('BACKUP 52 GB / 128 GB')).toBeInTheDocument();
  });
});

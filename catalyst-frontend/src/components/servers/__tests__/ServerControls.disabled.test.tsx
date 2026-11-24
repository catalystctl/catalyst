import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { ServerStatus } from '../../../types/server';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('../../../lib/queryClient', () => ({
  queryClient: {
    invalidateQueries: vi.fn(),
    cancelQueries: vi.fn(),
    setQueryData: vi.fn(),
    getQueryData: vi.fn(),
  },
}));
vi.mock('@/csync', () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn(), cancelQueries: vi.fn(), setQueryData: vi.fn(), getQueryData: () => undefined }),
  useMutation: () => ({ isPending: false, mutate: vi.fn() }),
}));
vi.mock('../../../services/api/servers', () => ({ serversApi: {} }));
vi.mock('../../../services/api/agent', () => ({ agentApi: {} }));
vi.mock('../../../utils/notify', () => ({ notifyError: vi.fn(), notifySuccess: vi.fn() }));

import ServerControls from '../ServerControls';

afterEach(cleanup);

const ALL_PERMISSIONS = ['server.start', 'server.stop', 'server.kill'];

const renderControls = (status: ServerStatus, permissions = ALL_PERMISSIONS) =>
  render(<ServerControls serverId="srv-1" status={status} permissions={permissions} />);

describe('disabled power controls explain themselves', () => {
  it('says Start is unavailable while the server installs', () => {
    renderControls('installing');
    const start = screen.getByRole('button', { name: 'controls.start' });
    expect(start).toBeDisabled();
    expect(start).toHaveAttribute('title', 'controls.disabled.status');
  });

  it('explains a stopped server cannot be stopped', () => {
    renderControls('stopped');
    const stop = screen.getByRole('button', { name: 'controls.stop' });
    expect(stop).toBeDisabled();
    expect(stop).toHaveAttribute('title', 'controls.disabled.status');
  });

  it('keeps an enabled control free of a disabled-reason tooltip', () => {
    renderControls('running');
    const stop = screen.getByRole('button', { name: 'controls.stop' });
    expect(stop).not.toBeDisabled();
    expect(stop).not.toHaveAttribute('title');
  });

  it('still names the compact icon variant while disabled', () => {
    render(
      <ServerControls
        serverId="srv-1"
        status="installing"
        permissions={[...ALL_PERMISSIONS, 'server.install']}
        compact
      />,
    );
    // Only Cancel install applies while installing; the icon keeps its name.
    const cancel = screen.getByRole('button', { name: 'controls.cancelInstall' });
    expect(cancel).toHaveAttribute('title', 'controls.cancelInstall');
  });

  it('renders nothing at all without a power grant', () => {
    const { container } = renderControls('running', ['server.read']);
    expect(container).toBeEmptyDOMElement();
  });
});
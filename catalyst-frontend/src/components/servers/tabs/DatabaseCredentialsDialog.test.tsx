import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import DatabaseCredentialsDialog from './DatabaseCredentialsDialog';

const credentials = {
  id: 'db1',
  name: 'amxbans',
  username: 'srv_cmthib_1w1msbvx',
  password: 'p0x8ynstnd2lf1scwyl59hxiv',
  host: 'catalyst-game-postgres',
  port: 5432,
  hostId: 'host1',
  hostName: 'Game Postgres',
  createdAt: '2026-09-14T20:19:26.793Z',
};

describe('DatabaseCredentialsDialog', () => {
  it('reveals the one-time credentials with copyable values', () => {
    render(<DatabaseCredentialsDialog credentials={credentials} onClose={() => {}} />);

    expect(screen.getByText('Database credentials')).toBeInTheDocument();
    expect(screen.getByText(/shown only once/)).toBeInTheDocument();
    expect(screen.getByText('catalyst-game-postgres:5432')).toBeInTheDocument();
    expect(screen.getByText('amxbans')).toBeInTheDocument();
    expect(screen.getByText('srv_cmthib_1w1msbvx')).toBeInTheDocument();
    expect(screen.getByText('p0x8ynstnd2lf1scwyl59hxiv')).toBeInTheDocument();
  });

  it('calls onClose when Done is clicked', () => {
    const onClose = vi.fn();
    render(<DatabaseCredentialsDialog credentials={credentials} onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    // AlertDialogAction fires onClick and the dialog close handler; both
    // dismiss to the same null state, so only assert dismissal happened.
    expect(onClose).toHaveBeenCalled();
  });
});

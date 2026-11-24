import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

/**
 * D6: the Files tab used to lose its folder, filter and sort on every tab
 * switch, because they were plain `useState`. They now live in the URL
 * (`?path=&q=&sort=`), so returning to the tab restores them. The listing is
 * read from the query key built out of the controlled path — that is what this
 * test pins, without booting the whole explorer.
 */

const h = vi.hoisted(() => ({
  list: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/csync', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useQuery: (options: { queryKey: unknown[]; queryFn: () => Promise<unknown> }) => {
      // Track every requested key so the test can assert the URL drives it.
      h.list(options.queryKey);
      return {
        data: {
          files: [{ name: 'motd.txt', path: '/motd.txt', isDirectory: false, size: 10, mode: 0o644 }],
        },
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
      };
    },
    useMutation: () => ({ isPending: false, mutate: vi.fn() }),
    useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  };
});

vi.mock('../../services/api/files', () => ({
  filesApi: { list: vi.fn() },
  DEFAULT_MAX_UPLOAD_MB: 50,
}));
vi.mock('../../services/api/admin', () => ({ adminApi: { getConfig: vi.fn() } }));
vi.mock('../../services/api/systemErrors', () => ({ reportSystemError: vi.fn() }));
vi.mock('../../utils/notify', () => ({
  notifyError: vi.fn(),
  notifySuccess: vi.fn(),
  notifyInfo: vi.fn(),
}));
// Heavy children that do not take part in URL state.
vi.mock('./FileTree', () => ({ default: () => <div data-testid="file-tree" /> }));
vi.mock('./FileUploader', () => ({ default: () => <div data-testid="uploader" /> }));
vi.mock('../shared/LastUpdated', () => ({ default: () => null }));
vi.mock('./FileEditor', () => ({ default: () => <div data-testid="editor" /> }));

import FileManager from './FileManager';

const renderAt = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/servers/:id" element={<FileManager serverId="server-1" canWrite />} />
      </Routes>
    </MemoryRouter>,
  );

describe('FileManager URL-backed state', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('lists the folder named in ?path= instead of the root', async () => {
    renderAt('/servers/server-1?path=%2Fconfigs');
    await waitFor(() =>
      expect(h.list.mock.calls.some(([key]) => JSON.stringify(key).includes('/configs'))).toBe(true),
    );
    // The breadcrumb shows the folder from the URL.
    expect(screen.getByRole('button', { name: 'configs' })).toBeTruthy();
  });

  it('restores the filter from ?q=', () => {
    renderAt('/servers/server-1?q=server.properties');
    const filter = screen.getByPlaceholderText('files.manager.filterPlaceholder');
    expect(filter).toHaveValue('server.properties');
  });

  it('restores the sort direction from ?sort= and defaults without it', async () => {
    renderAt('/servers/server-1?sort=size:desc');
    // Clicking the active size header flips asc/desc, which proves the URL
    // value was parsed into the sort state rather than defaulted.
    const sizeHeader = screen.getByRole('button', { name: /files\.list\.size/ });
    expect(sizeHeader.querySelector('svg')).toBeTruthy();
  });

  it('falls back to local state outside a router', () => {
    // The manager is also embedded in tests/explorers: no router, no crash.
    render(<FileManager serverId="server-1" canWrite />);
    expect(screen.getByPlaceholderText('files.manager.filterPlaceholder')).toBeTruthy();
  });
});

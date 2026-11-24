import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { FileEntry } from '../../types/file';

/**
 * FileList behaviours from the audit:
 *  - the context menu advertises ↵ / F2 / Del, so the focused row answers them;
 *  - creating a file/folder is an inline row at the top of the listing rather
 *    than a dialog (D3), and the rename input cannot be resubmitted while the
 *    rename request is still in flight.
 */

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// The virtualizer needs a laid-out scroll element; one row per item is enough
// to exercise row behaviour.
vi.mock('../../hooks/useFileListVirtualizer', () => ({
  useFileListVirtualizer: (count: number) => ({
    totalSize: count * 44,
    virtualItems: Array.from({ length: count }, (_, index) => ({ index, start: index * 44 })),
  }),
}));

import FileList from './FileList';

const entry = (name: string, isDirectory = false): FileEntry =>
  ({ name, path: `/${name}`, isDirectory, size: 10, mode: 0o644 } as FileEntry);

const baseProps = {
  files: [entry('server.properties'), entry('configs', true)],
  selectedPaths: new Set<string>(),
  isLoading: false,
  isError: false,
  allSelected: false,
  sortField: 'name' as const,
  sortDirection: 'asc' as const,
  renamingEntry: null,
  onSort: vi.fn(),
  onSelectAll: vi.fn(),
  onOpen: vi.fn(),
  onSelect: vi.fn(),
  onShiftSelect: vi.fn(),
  onDownload: vi.fn(),
  onCopyPath: vi.fn(),
  onRename: vi.fn(),
  onRenameSubmit: vi.fn(),
  onRenameCancel: vi.fn(),
  onDelete: vi.fn(),
  onCompress: vi.fn(),
  onDecompress: vi.fn(),
  onPermissions: vi.fn(),
};

const rowFor = (name: string) => {
  const nameNode = screen.getByText(name);
  let node: HTMLElement | null = nameNode;
  while (node && node.getAttribute('role') !== 'row') node = node.parentElement;
  if (!node) throw new Error(`no row for ${name}`);
  return node;
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('FileList keyboard shortcuts on a focused row', () => {
  it('Enter opens, F2 renames and Delete deletes', () => {
    render(<FileList {...baseProps} />);
    const row = rowFor('server.properties');

    fireEvent.keyDown(row, { key: 'Enter' });
    expect(baseProps.onOpen).toHaveBeenCalledWith(expect.objectContaining({ name: 'server.properties' }));

    fireEvent.keyDown(row, { key: 'F2' });
    expect(baseProps.onRename).toHaveBeenCalledWith(expect.objectContaining({ name: 'server.properties' }));

    fireEvent.keyDown(row, { key: 'Delete' });
    expect(baseProps.onDelete).toHaveBeenCalledWith(expect.objectContaining({ name: 'server.properties' }));
  });

  it('leaves keystrokes from the inline inputs alone', () => {
    render(<FileList {...baseProps} renamingEntry={entry('server.properties')} />);
    const input = screen.getByRole('textbox');
    // Typing "Delete" inside the rename box must not delete the file.
    fireEvent.keyDown(input, { key: 'Delete' });
    fireEvent.keyDown(input, { key: 'F2' });
    expect(baseProps.onDelete).not.toHaveBeenCalled();
    expect(baseProps.onRename).not.toHaveBeenCalled();
  });

  it('makes the row focusable and marks it while focused', () => {
    render(<FileList {...baseProps} />);
    const row = rowFor('server.properties');
    expect(row).toHaveAttribute('tabindex', '0');
    fireEvent.focus(row);
    expect(row).toHaveAttribute('data-focused', 'true');
  });
});

describe('FileList inline rename pending state', () => {
  it('disables the rename input while the mutation is pending', () => {
    render(
      <FileList
        {...baseProps}
        renamingEntry={entry('server.properties')}
        renamePending
      />,
    );
    expect(screen.getByRole('textbox')).toBeDisabled();
  });

  it('does not resubmit the rename from the blur caused by the pending state', () => {
    render(
      <FileList
        {...baseProps}
        renamingEntry={entry('server.properties')}
        renamePending
      />,
    );
    fireEvent.blur(screen.getByRole('textbox'));
    expect(baseProps.onRenameSubmit).not.toHaveBeenCalled();
  });
});

describe('FileList inline create row', () => {
  const createProps = {
    ...baseProps,
    createMode: 'file' as const,
    createName: 'motd.txt',
    createPending: false,
    onCreateNameChange: vi.fn(),
    onCreateSubmit: vi.fn(),
    onCreateCancel: vi.fn(),
  };

  it('renders an input row instead of opening a dialog', () => {
    render(<FileList {...createProps} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    const input = screen.getByRole('textbox', { name: 'files.manager.newFile' });
    expect(input).toHaveValue('motd.txt');
  });

  it('creates on Enter and cancels on Escape', () => {
    render(<FileList {...createProps} />);
    const input = screen.getByRole('textbox', { name: 'files.manager.newFile' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(createProps.onCreateSubmit).toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(createProps.onCreateCancel).toHaveBeenCalled();
  });

  it('still shows the create row when the folder is empty', () => {
    render(<FileList {...createProps} files={[]} />);
    expect(screen.getByRole('textbox', { name: 'files.manager.newFile' })).toBeTruthy();
    // The empty state must not replace the row the user is typing into.
    expect(screen.queryByText('files.list.emptyTitle')).toBeNull();
  });

  it('labels a folder row as the new folder', () => {
    render(<FileList {...createProps} createMode="directory" createName="" />);
    expect(screen.getByRole('textbox', { name: 'files.manager.newFolder' })).toBeTruthy();
  });
});

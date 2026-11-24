import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

/**
 * D11: the editor is a full-screen dialog, so comparing two files meant
 * close → find → reopen. Prev/Next walk the listing, and a dirty buffer still
 * goes through the existing unsaved-changes confirm first.
 */

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, opts?: Record<string, unknown>) => (opts ? `${key}:${JSON.stringify(opts)}` : key) }),
}));
vi.mock('../../stores/themeStore', () => ({ useThemeStore: (selector: (s: { theme: string }) => unknown) => selector({ theme: 'dark' }) }));
// Monaco is a lazily-loaded browser dependency; its props are not the subject.
vi.mock('@monaco-editor/react', () => ({
  default: ({ value }: { value: string }) => <textarea readOnly value={value} data-testid="monaco" />,
}));

import FileEditor from './FileEditor';

const file = {
  path: '/server.properties',
  name: 'server.properties',
  content: 'motd=hello',
  originalContent: 'motd=hello',
};

const baseProps = {
  file,
  isLoading: false,
  isSaving: false,
  isDirty: false,
  onChange: vi.fn(),
  onSave: vi.fn(),
  onReset: vi.fn(),
  onClose: vi.fn(),
};

const renderEditor = (props: Partial<Parameters<typeof FileEditor>[0]> = {}) =>
  render(
    <FileEditor
      {...baseProps}
      previousName="ops.json"
      nextName="whitelist.json"
      onPrevious={vi.fn()}
      onNext={vi.fn()}
      {...props}
    />,
  );

describe('FileEditor file navigation', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('switches to the adjacent file when the buffer is clean', () => {
    const onNext = vi.fn();
    const onPrevious = vi.fn();
    renderEditor({ onNext, onPrevious });

    fireEvent.click(screen.getByRole('button', { name: 'files.editor.nextFile' }));
    expect(onNext).toHaveBeenCalled();
    // Navigating must not close the editor.
    expect(baseProps.onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'files.editor.previousFile' }));
    expect(onPrevious).toHaveBeenCalled();
  });

  it('names the target file in the tooltip', () => {
    renderEditor();
    expect(screen.getByRole('button', { name: 'files.editor.nextFile' })).toHaveAttribute(
      'title',
      'files.editor.nextFileNamed:{"name":"whitelist.json"}',
    );
  });

  it('asks before discarding a dirty buffer when navigating', () => {
    const onNext = vi.fn();
    renderEditor({ isDirty: true, onNext });

    fireEvent.click(screen.getByRole('button', { name: 'files.editor.nextFile' }));
    // The confirm dialog appears and nothing has been swapped yet.
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    expect(onNext).not.toHaveBeenCalled();

    // Discarding swaps files without closing the editor.
    fireEvent.click(screen.getByRole('button', { name: 'files.editor.discard' }));
    expect(onNext).toHaveBeenCalled();
    expect(baseProps.onClose).not.toHaveBeenCalled();
  });

  it('keeps editing when the discard is cancelled', () => {
    const onNext = vi.fn();
    renderEditor({ isDirty: true, onNext });

    fireEvent.click(screen.getByRole('button', { name: 'files.editor.nextFile' }));
    fireEvent.click(screen.getByRole('button', { name: 'files.editor.keepEditing' }));
    expect(onNext).not.toHaveBeenCalled();
    expect(baseProps.onClose).not.toHaveBeenCalled();
  });

  it('disables the buttons at either end of the listing', () => {
    renderEditor({ onPrevious: undefined, previousName: undefined, onNext: undefined, nextName: undefined });
    expect(screen.getByRole('button', { name: 'files.editor.previousFile' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'files.editor.nextFile' })).toBeDisabled();
  });

  it('still closes (not navigates) from the X button', () => {
    const onClose = vi.fn();
    renderEditor({ onClose });
    fireEvent.click(screen.getByRole('button', { name: 'common:actions.close' }));
    expect(onClose).toHaveBeenCalled();
  });
});
